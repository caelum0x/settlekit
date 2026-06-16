/**
 * Delivery routes (plan §26, §21).
 *
 *   GET  /v1/delivery-runs            — list runs (optionally per org/payment)
 *   GET  /v1/delivery-runs/:id        — fetch a run
 *   POST /v1/delivery-runs/:id/retry  — re-run failed actions of a run
 *   POST /v1/delivery-actions/test    — execute a single action through the REAL
 *                                       handler registry + in-process clients
 *
 * The test endpoint resolves the handler for the requested action type from the
 * default `@settlekit/delivery` registry and executes it against the in-process
 * `DeliveryClients`, returning the handler's real output.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  generateId,
  notFound,
  validationError,
  type DeliveryAction,
  type DeliveryActionRun,
} from "@settlekit/common";
import type { DeliveryContext as RunnerContext } from "@settlekit/delivery";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

// Zod schema for the discriminated DeliveryAction union (plan §15).
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github_invite"), repoId: z.string().min(1), permission: z.enum(["pull", "push", "maintain"]).optional() }),
  z.object({ type: z.literal("github_team_add"), orgLogin: z.string().min(1), teamSlug: z.string().min(1) }),
  z.object({ type: z.literal("license_key_create"), policyId: z.string().min(1) }),
  z.object({ type: z.literal("api_key_create"), scopes: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("file_access_grant"), fileId: z.string().min(1) }),
  z.object({ type: z.literal("discord_role_add"), guildId: z.string().min(1), roleId: z.string().min(1) }),
  z.object({ type: z.literal("saas_entitlement_create"), features: z.record(z.union([z.boolean(), z.number(), z.string()])) }),
  z.object({ type: z.literal("webhook_send"), url: z.string().url() }),
  z.object({ type: z.literal("email_send"), template: z.string().min(1) }),
]);

const testSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  customerId: z.string().min(1).default("cus_test"),
  productId: z.string().min(1).default("prod_test"),
  paymentId: z.string().min(1).default("pay_test"),
  entitlementId: z.string().min(1).default("ent_test"),
  customerEmail: z.string().email().optional(),
  githubInstallationId: z.number().int().positive().optional(),
  githubUsername: z.string().optional(),
  discordUserId: z.string().optional(),
  action: actionSchema,
});

export function deliveryRunRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's delivery runs.
    const orgId = requireOrg(c);
    const paymentId = c.req.query("paymentId");
    const runs = await c.get("ctx").deliveryRuns.list((r) => {
      if (r.organizationId !== orgId) return false;
      if (paymentId && r.paymentId !== paymentId) return false;
      return true;
    });
    return data(c, runs);
  });

  app.get("/:id", async (c) => {
    const run = await c.get("ctx").deliveryRuns.findById(c.req.param("id"));
    if (!run) throw notFound("delivery run not found", { id: c.req.param("id") });
    return data(c, run);
  });

  // Retry the failed actions of a run by marking them pending again.
  app.post("/:id/retry", async (c) => {
    const ctx = c.get("ctx");
    const run = await ctx.deliveryRuns.findById(c.req.param("id"));
    if (!run) throw notFound("delivery run not found", { id: c.req.param("id") });
    const actionRuns: DeliveryActionRun[] = run.actionRuns.map((ar) =>
      ar.status === "failed" ? { ...ar, status: "pending", attempts: ar.attempts } : ar,
    );
    const hasPending = actionRuns.some((ar) => ar.status === "pending");
    const updated = await ctx.deliveryRuns.save({
      ...run,
      status: hasPending ? "pending" : run.status,
      actionRuns,
    });
    return data(c, updated);
  });

  return app;
}

/** /v1/delivery-actions — test a single action handler. */
export function deliveryActionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/test", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, testSchema);
    const action = body.action as DeliveryAction;

    const handler = ctx.deliveryRegistry.get(action.type);
    if (!handler) {
      throw notFound(`no delivery handler registered for action "${action.type}"`, {
        type: action.type,
      });
    }

    const runnerCtx: RunnerContext = {
      organizationId: requireOrg(c),
      customerId: body.customerId,
      productId: body.productId,
      paymentId: body.paymentId,
      entitlementId: body.entitlementId,
      ...(body.githubInstallationId !== undefined ? { githubInstallationId: body.githubInstallationId } : {}),
      ...(body.githubUsername !== undefined ? { githubUsername: body.githubUsername } : {}),
      ...(body.discordUserId !== undefined ? { discordUserId: body.discordUserId } : {}),
      ...(body.customerEmail !== undefined ? { customerEmail: body.customerEmail } : {}),
      clients: ctx.deliveryClients,
    };

    try {
      const output = await handler.execute(action, runnerCtx);
      return created(c, { action, status: "succeeded", output });
    } catch (err) {
      // Surface the handler's own SettleKitError, else wrap as validation_error.
      if (err && typeof err === "object" && "httpStatus" in err) throw err;
      throw validationError("delivery action test failed", {
        type: action.type,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

/** Build a recorded delivery run skeleton (used when seeding runs from tests). */
export function buildDeliveryRunRecord(input: {
  organizationId: string;
  paymentId: string;
  customerId: string;
  deliveryPlanId: string;
  actions: DeliveryAction[];
}) {
  const actionRuns: DeliveryActionRun[] = input.actions.map((action) => ({
    id: generateId("deliveryAction"),
    action,
    status: "pending",
    attempts: 0,
  }));
  return {
    id: generateId("deliveryRun"),
    organizationId: input.organizationId,
    paymentId: input.paymentId,
    customerId: input.customerId,
    deliveryPlanId: input.deliveryPlanId,
    status: "pending" as const,
    actionRuns,
    createdAt: new Date().toISOString(),
  };
}

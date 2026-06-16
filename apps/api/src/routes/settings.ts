/**
 * Organization settings routes — the merchant dashboard's editable config.
 *
 *   GET  /v1/settings?organizationId=   read settings (defaults when unset)
 *   POST /v1/settings                   patch settings (persisted)
 *
 * Backed by the real {@link OrgSettingsStore} (Postgres org metadata, or
 * in-memory). Unknown keys are ignored; provided keys are merged over current.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const patchSchema = z.object({
  organizationId: z.string().min(1).optional(),
  orgName: z.string().min(1).optional(),
  supportEmail: z.string().optional(),
  payoutCurrency: z.string().min(1).optional(),
  webhookSecret: z.string().optional(),
  defaultRail: z.enum(["arc", "circle", "x402"]).optional(),
});

export function settingsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Tenant-scoped: settings for the authenticated organization.
    const settings = await c.get("ctx").orgSettings.get(requireOrg(c));
    return data(c, settings);
  });

  app.post("/", async (c) => {
    const body = await parseBody(c, patchSchema);
    // Drop any client-supplied organizationId; the tenant is the authenticated org.
    const { organizationId, ...patch } = body;
    void organizationId;
    const settings = await c.get("ctx").orgSettings.update(requireOrg(c), patch);
    return data(c, settings);
  });

  return app;
}

/**
 * Platform billing routes: what a merchant owes SettleKit.
 *
 *   GET  /v1/billing/fees             schedule, standing, accrued (unbilled) fees, statements
 *   POST /v1/billing/statements/run   issue every merchant's statement for a closed month
 *                                     (platform operator only: the platform org or bootstrap key)
 */
import { Hono } from "hono";
import { z } from "zod";
import { SettleKitError } from "@settlekit/common";
import { previousPeriod } from "@settlekit/platform-billing";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";
import {
  accruedFees,
  loadPlatformBillingConfig,
  runStatements,
  standingFor,
  statementView,
  statementsFor,
} from "../platform/fee-statements.js";

const runSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM").optional(),
});

export function billingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/fees", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const cfg = loadPlatformBillingConfig();
    const now = new Date();
    const accrued = await accruedFees(ctx, cfg, org, now);
    const statements = cfg ? await statementsFor(ctx, cfg, org) : [];
    return data(c, {
      configured: cfg !== null,
      schedule: ctx.platformFeeSchedule,
      standing: await standingFor(ctx, cfg, org, now),
      graceDays: cfg?.graceDays ?? null,
      accrued: {
        since: accrued.coverageStart,
        paymentCount: accrued.paymentCount,
        grossVolume: accrued.grossVolume.amount,
        fees: accrued.fees.amount,
      },
      statements: statements.map(statementView).reverse(),
    });
  });

  app.post("/statements/run", async (c) => {
    const ctx = c.get("ctx");
    const cfg = loadPlatformBillingConfig();
    if (!cfg) {
      throw new SettleKitError({ code: "validation_error", message: "platform billing is not configured (set PLATFORM_BILLING_ORG_ID)" });
    }
    const isOperator = c.get("apiKeyId") === "bootstrap" || requireOrg(c) === cfg.orgId;
    if (!isOperator) throw new SettleKitError({ code: "forbidden", message: "only the platform operator can run statements" });
    const body = await parseBody(c, runSchema);
    return data(c, await runStatements(ctx, cfg, body.period ?? previousPeriod(new Date())));
  });

  return app;
}

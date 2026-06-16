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
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

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
    const organizationId = c.req.query("organizationId") ?? DEFAULT_ORG_ID;
    const settings = await c.get("ctx").orgSettings.get(organizationId);
    return data(c, settings);
  });

  app.post("/", async (c) => {
    const body = await parseBody(c, patchSchema);
    const { organizationId, ...patch } = body;
    const settings = await c.get("ctx").orgSettings.update(organizationId ?? DEFAULT_ORG_ID, patch);
    return data(c, settings);
  });

  return app;
}

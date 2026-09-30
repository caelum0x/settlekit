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
import { validationError } from "@settlekit/common";
import { normalizeTaxSettings } from "@settlekit/persistence";
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
  /** Checkout tax + seller tax identity printed on receipts. */
  tax: z
    .object({
      enabled: z.boolean(),
      label: z.string().max(40).default("Tax"),
      sellerCountry: z.string().max(2).optional(),
      taxId: z.string().max(64).optional(),
      legalName: z.string().max(200).optional(),
      addressLines: z.array(z.string().max(200)).max(6).optional(),
      defaultRateBps: z.number().int().min(0).max(10_000).default(0),
      rates: z.record(z.string(), z.number().int().min(0).max(10_000)).default({}),
      reverseCharge: z.boolean().default(false),
    })
    .optional(),
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
    const { organizationId, tax, ...rest } = body;
    void organizationId;
    let patch: typeof rest & { tax?: ReturnType<typeof normalizeTaxSettings> } = rest;
    if (tax !== undefined) {
      try {
        patch = { ...rest, tax: normalizeTaxSettings(tax) };
      } catch (error) {
        throw validationError(error instanceof Error ? error.message : "invalid tax settings", { fields: ["tax"] });
      }
    }
    const settings = await c.get("ctx").orgSettings.update(requireOrg(c), patch);
    return data(c, settings);
  });

  return app;
}

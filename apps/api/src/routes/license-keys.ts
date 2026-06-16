/**
 * License key routes (plan §6).
 *
 * Issues machine/domain-limited license keys via the real
 * `@settlekit/license-keys` `LicenseService`, mints offline validation tokens,
 * and verifies a presented key for a product + machine (activating the machine
 * when new and within capacity).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const issueSchema = z.object({
  organizationId: z.string().min(1),
  customerId: z.string().min(1),
  productId: z.string().min(1),
  entitlementId: z.string().min(1),
  machineLimit: z.number().int().positive().default(1),
  domainLimit: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

const verifySchema = z.object({
  licenseKey: z.string().min(1),
  productId: z.string().min(1),
  machineId: z.string().min(1),
});

export function licenseRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List all issued license keys (merchant-wide).
  app.get("/", async (c) => {
    return data(c, await c.get("ctx").licenses.list());
  });

  // Issue a license key.
  app.post("/", async (c) => {
    const body = await parseBody(c, issueSchema);
    const license = await c.get("ctx").licenses.issue({
      organizationId: body.organizationId,
      customerId: body.customerId,
      productId: body.productId,
      entitlementId: body.entitlementId,
      machineLimit: body.machineLimit,
      ...(body.domainLimit !== undefined ? { domainLimit: body.domainLimit } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    });
    return created(c, license);
  });

  // Verify a license key for a product + machine.
  app.post("/verify", async (c) => {
    const body = await parseBody(c, verifySchema);
    const result = await c.get("ctx").licenses.verify({
      licenseKey: body.licenseKey,
      productId: body.productId,
      machineId: body.machineId,
    });
    return data(c, result);
  });

  // Mint an offline validation token for an existing license.
  app.post("/:id/token", async (c) => {
    const token = await c.get("ctx").licenses.issueToken(c.req.param("id"));
    return data(c, { token });
  });

  // Revoke a license.
  app.post("/:id/revoke", async (c) => {
    const revoked = await c.get("ctx").licenses.revoke(c.req.param("id"));
    return data(c, revoked);
  });

  return app;
}

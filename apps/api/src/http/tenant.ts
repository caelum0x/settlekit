/**
 * Tenant scoping helper.
 *
 * The auth middleware binds the authenticated API key's `organizationId` onto
 * the request. `requireOrg` reads it so route handlers scope every read/write
 * to the caller's tenant instead of trusting a client-supplied `organizationId`
 * or falling back to the shared platform default.
 *
 * Falls back to {@link DEFAULT_ORG_ID} only for the bootstrap key (dev/admin),
 * which the middleware binds explicitly.
 */
import type { Context } from "hono";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";

/** The organization the current request is authenticated for. */
export function requireOrg(c: Context<AppEnv>): string {
  return c.get("organizationId") ?? DEFAULT_ORG_ID;
}

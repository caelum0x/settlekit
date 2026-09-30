/**
 * Bearer authentication middleware (plan §4).
 *
 * Accepts two credential kinds in the `Authorization: Bearer <token>` slot:
 *   1. A programmatic **API key** (`sk_live_…`), verified against the real
 *      `@settlekit/api-keys` `ApiKeyService`. Its `organizationId` is bound.
 *   2. A first-party **session token** (the dashboard's `sk_session`), verified
 *      against the `@settlekit/auth` service. The signed-in account's
 *      `organizationId` is bound. This lets the merchant dashboard call the API
 *      with the session it already holds — no long-lived platform key in the
 *      browser. Sessions for accounts without an organization are rejected.
 *
 * On success it exposes the credential id + the bound `organizationId` on the
 * request context so routes scope every read/write to the caller's tenant; on
 * failure it throws a `unauthorized` {@link SettleKitError} (HTTP 401) which the
 * error middleware maps to `{ error }`.
 *
 * A platform **service token** (`SETTLEKIT_SERVICE_TOKEN`) lets SettleKit's own
 * hosted checkout call the onchain-billing API server-side on behalf of the
 * checkout session's seller: it must name that seller in
 * `X-SettleKit-Organization`, and it is accepted ONLY under
 * `/v1/onchain-billing` (subscribe / grant / buyer cancel), never elsewhere.
 * It never reaches a browser.
 *
 * A bootstrap key may be supplied via `API_BOOTSTRAP_KEY` so the very first
 * caller can authenticate before any keys exist in the store — handy for local
 * dev and for the test client.
 */
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { SettleKitError } from "@settlekit/common";
import { isPlatformKey, isTeamRole, requiredScope, scopesAllow, scopesForRole } from "@settlekit/api-keys";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";

const BEARER_RE = /^Bearer\s+(.+)$/i;
const SERVICE_SCOPE = "/v1/onchain-billing/";
const ORG_HEADER = "x-settlekit-organization";
const ORG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Constant-time string comparison (length leak only). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function unauthorized(message: string): SettleKitError {
  return new SettleKitError({ code: "unauthorized", message });
}

/** 403 unless `granted` covers the scope this request needs. */
function assertScope(granted: readonly string[], method: string, path: string, who: string): void {
  const scope = requiredScope(method, path);
  if (scopesAllow(granted, scope)) return;
  throw new SettleKitError({
    code: "forbidden",
    message: `${who} does not have the ${scope} permission`,
    details: { requiredScope: scope },
  });
}

/** Require a valid Bearer API key on every request this middleware guards. */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  const bootstrapKey = process.env.API_BOOTSTRAP_KEY;
  const serviceToken = process.env.SETTLEKIT_SERVICE_TOKEN?.trim();
  if (serviceToken !== undefined && serviceToken.length > 0 && serviceToken.length < 32) {
    throw new Error("SETTLEKIT_SERVICE_TOKEN must be at least 32 characters");
  }

  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header) {
      throw unauthorized("Missing Authorization header");
    }
    const match = BEARER_RE.exec(header);
    if (!match || !match[1]) {
      throw unauthorized("Authorization header must be 'Bearer <api-key>'");
    }
    const plaintext = match[1].trim();

    // Hosted-checkout service path: onchain billing only, bound to one seller.
    if (serviceToken && safeEqual(plaintext, serviceToken)) {
      if (!c.req.path.startsWith(SERVICE_SCOPE)) throw unauthorized("Service token is not valid for this route");
      const org = c.req.header(ORG_HEADER)?.trim();
      if (!org || !ORG_ID_RE.test(org)) throw unauthorized(`Service token requires the ${ORG_HEADER} header`);
      c.set("apiKeyId", "service:checkout");
      c.set("organizationId", org);
      await next();
      return;
    }

    // Bootstrap path: a configured static key authenticates without the store.
    // It operates on the platform default organization.
    if (bootstrapKey && plaintext === bootstrapKey) {
      c.set("apiKeyId", "bootstrap");
      c.set("organizationId", DEFAULT_ORG_ID);
      c.set("grantedScopes", ["*"]);
      await next();
      return;
    }

    const ctx = c.get("ctx");
    const result = await ctx.apiKeys.verify(plaintext);
    if (result.valid && result.apiKey) {
      // Keys delivered to BUYERS (product access keys) are not management
      // credentials: they must never act as the merchant.
      if (!isPlatformKey(result.apiKey)) {
        throw new SettleKitError({
          code: "forbidden",
          message: "This is a customer access key; it cannot call the SettleKit management API",
        });
      }
      assertScope(result.apiKey.scopes, c.req.method, c.req.path, "This API key");
      c.set("grantedScopes", result.apiKey.scopes);
      // Best-effort usage stamp; never block the request on a usage write failure.
      try {
        await ctx.apiKeys.recordUsage(plaintext);
      } catch {
        /* non-fatal */
      }

      c.set("apiKeyId", result.apiKey.id);
      // Bind the key's organization so routes scope reads/writes to the tenant.
      c.set("organizationId", result.apiKey.organizationId);
      await next();
      return;
    }

    // Not an API key — try a first-party session token (the dashboard's
    // `sk_session`). A valid merchant session scopes the request to its org.
    const session = await ctx.auth.authenticateSession(plaintext);
    if (session.ok) {
      const { account } = session.value;
      if (!account.organizationId) {
        throw unauthorized("Session account has no organization");
      }
      // Team roles: accounts that created the org have no role (owner).
      const role = account.role && isTeamRole(account.role) ? account.role : "owner";
      assertScope(scopesForRole(role), c.req.method, c.req.path, `Your role (${role})`);
      c.set("teamRole", role);
      c.set("grantedScopes", scopesForRole(role));
      c.set("apiKeyId", `session:${account.id}`);
      c.set("organizationId", account.organizationId);
      await next();
      return;
    }

    throw unauthorized("Invalid or revoked credential");
  };
}

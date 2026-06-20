/**
 * Public authentication routes (no API key required).
 *
 * Implements the SettleKit AUTH API CONTRACT under `/v1/auth`:
 *   - POST /register             -> { data: { account, sessionToken } }
 *   - POST /login                -> { data: { account, sessionToken } }
 *   - POST /magic-link/request   -> { data: { ok: true, devToken? } }
 *   - POST /magic-link/complete  -> { data: { account, sessionToken } }
 *   - GET  /session              -> { data: { account } }
 *   - POST /logout               -> { data: { ok: true } }
 *
 * Validation uses zod via {@link parseBody}; domain `Result` errors surface as
 * {@link SettleKitError} through {@link unwrapResult} so the central error
 * middleware maps them to the `{ error }` envelope with the right HTTP status
 * (`unauthorized` 401, `validation_error` 400, `conflict` 409).
 *
 * On every successful sign-in the opaque session token is also written to a
 * signed `sk_session` cookie (HMAC via the package's `signCookie`) so browser
 * clients can persist it; the same token is returned in the body for non-cookie
 * callers.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { SettleKitError, generateId } from "@settlekit/common";
import { signCookie } from "@settlekit/auth";
import type { Account, Session } from "@settlekit/auth";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody, unwrapResult } from "../http/validate.js";

/** Name of the cookie clients store the opaque session token in. */
const SESSION_COOKIE = "sk_session";

/**
 * Sentinel product/entitlement id for a merchant **platform** key. Platform keys
 * are org-scoped admin credentials (not tied to a sold product), so they reuse
 * the api-key store with this sentinel + the `platform:admin` scope.
 */
const PLATFORM_SENTINEL = "__platform__";

const BEARER_RE = /^Bearer\s+(.+)$/i;

const registerSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  type: z.enum(["merchant", "customer"]),
  organizationId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const magicLinkRequestSchema = z.object({
  email: z.string().min(1),
});

const magicLinkCompleteSchema = z.object({
  token: z.string().min(1),
});

const walletNonceSchema = z.object({
  address: z.string().min(1),
});

const walletLoginSchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be 0x-hex"),
  type: z.enum(["merchant", "customer"]).optional(),
});

const walletLinkSchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be 0x-hex"),
});

function unauthorized(message: string): SettleKitError {
  return new SettleKitError({ code: "unauthorized", message });
}

/** Extract the Bearer session token from the Authorization header, or throw. */
function requireBearer(authorization: string | undefined): string {
  if (!authorization) {
    throw unauthorized("Missing Authorization header");
  }
  const match = BEARER_RE.exec(authorization);
  if (!match || !match[1]) {
    throw unauthorized("Authorization header must be 'Bearer <sessionToken>'");
  }
  return match[1].trim();
}

export function authRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Persist the opaque session token in the signed `sk_session` cookie.
  const setSessionCookie = (c: Context<AppEnv>, session: Session): void => {
    const secret = c.get("ctx").authCookieSecret;
    setCookie(c, SESSION_COOKIE, signCookie(session.token, secret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(session.expiresAt),
    });
  };

  // POST /register -> create a password account and open a session.
  app.post("/register", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, registerSchema);

    // A new merchant gets its own organization (its tenant boundary). Customers
    // join an explicitly-provided org. The org id is attached to the account so
    // the merchant's platform key — and every scoped read/write — is isolated.
    const organizationId =
      body.organizationId ??
      (body.type === "merchant" ? generateId("organization") : undefined);

    const account: Account = unwrapResult(
      await ctx.auth.registerWithPassword({
        type: body.type,
        email: body.email,
        password: body.password,
        ...(organizationId !== undefined ? { organizationId } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      }),
    );

    // Issue the merchant's platform API key (Stripe-style `sk_…`), scoped to the
    // org with admin rights. Shown ONCE here; the auth middleware binds its org
    // on every subsequent `/v1/*` call. Customers don't get a platform key.
    let apiKey: string | undefined;
    if (account.type === "merchant" && organizationId) {
      const issued = await ctx.apiKeys.issue({
        organizationId,
        customerId: account.id,
        productId: PLATFORM_SENTINEL,
        entitlementId: PLATFORM_SENTINEL,
        scopes: ["platform:admin"],
        env: "live",
      });
      apiKey = issued.plaintext;
    }

    // Open a session immediately so registration returns a usable token.
    const login = unwrapResult(
      await ctx.auth.loginWithPassword({ email: body.email, password: body.password }),
    );
    setSessionCookie(c, login.session);
    return created(c, {
      account,
      sessionToken: login.session.token,
      ...(apiKey ? { apiKey } : {}),
    });
  });

  // POST /login -> verify credentials and open a session.
  app.post("/login", async (c) => {
    const body = await parseBody(c, loginSchema);
    const result = unwrapResult(
      await c.get("ctx").auth.loginWithPassword({ email: body.email, password: body.password }),
    );
    setSessionCookie(c, result.session);
    return data(c, { account: result.account, sessionToken: result.session.token });
  });

  // POST /magic-link/request -> issue a single-use sign-in token.
  // When no email transport is configured the devToken is returned so the flow
  // remains testable; otherwise the link is delivered via the email client.
  app.post("/magic-link/request", async (c) => {
    const body = await parseBody(c, magicLinkRequestSchema);
    const ctx = c.get("ctx");
    const issued = unwrapResult(await ctx.auth.requestMagicLink(body.email));

    if (ctx.email === null) {
      return data(c, { ok: true as const, devToken: issued.token });
    }

    await ctx.email.send({
      to: issued.magicLink.email,
      subject: "Your SettleKit sign-in link",
      html: `<p>Use this token to finish signing in: <code>${issued.token}</code></p>`,
      text: `Use this token to finish signing in: ${issued.token}`,
    });
    return data(c, { ok: true as const });
  });

  // POST /magic-link/complete -> consume the token and open a session.
  app.post("/magic-link/complete", async (c) => {
    const body = await parseBody(c, magicLinkCompleteSchema);
    const result = unwrapResult(await c.get("ctx").auth.completeMagicLink(body.token));
    setSessionCookie(c, result.session);
    return data(c, { account: result.account, sessionToken: result.session.token });
  });

  // POST /wallet/nonce -> issue a single-use SIWE nonce bound to the address.
  app.post("/wallet/nonce", async (c) => {
    const body = await parseBody(c, walletNonceSchema);
    const result = unwrapResult(await c.get("ctx").auth.requestWalletNonce(body.address));
    return data(c, { nonce: result.nonce, address: result.address });
  });

  // POST /wallet/login -> verify the SIWE signature and open a session.
  app.post("/wallet/login", async (c) => {
    const body = await parseBody(c, walletLoginSchema);
    const result = unwrapResult(
      await c.get("ctx").auth.loginWithWallet({
        message: body.message,
        signature: body.signature as `0x${string}`,
        ...(body.type !== undefined ? { type: body.type } : {}),
      }),
    );
    setSessionCookie(c, result.session);
    return data(c, { account: result.account, sessionToken: result.session.token });
  });

  // POST /wallet/link -> attach a wallet to the authenticated account.
  app.post("/wallet/link", async (c) => {
    const token = requireBearer(c.req.header("authorization"));
    const body = await parseBody(c, walletLinkSchema);
    const result = unwrapResult(
      await c.get("ctx").auth.linkWallet(token, {
        message: body.message,
        signature: body.signature as `0x${string}`,
      }),
    );
    return data(c, { account: result.account });
  });

  // GET /session -> resolve the account for the presented session token.
  app.get("/session", async (c) => {
    const token = requireBearer(c.req.header("authorization"));
    const result = unwrapResult(await c.get("ctx").auth.authenticateSession(token));
    return data(c, { account: result.account });
  });

  // POST /logout -> revoke the session token (idempotent) and clear the cookie.
  app.post("/logout", async (c) => {
    const token = requireBearer(c.req.header("authorization"));
    unwrapResult(await c.get("ctx").auth.logout(token));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return data(c, { ok: true as const });
  });

  return app;
}

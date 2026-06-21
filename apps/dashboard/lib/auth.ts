// Real auth client for the SettleKit merchant dashboard.
//
// These functions call the public auth endpoints under NEXT_PUBLIC_API_URL
// (/v1/auth/*) and return a typed { data } / { error } result. They are
// transport-agnostic: they do NOT touch cookies. Cookie persistence of the
// returned sessionToken (the "sk_session" cookie) is handled by the
// app/api/session route handler, which sets an httpOnly cookie for real
// security. Client components POST the sessionToken to that route after a
// successful auth call.

import { API_URL } from "./config";

/** Account type. The dashboard registers merchants. */
export type AccountType = "merchant" | "customer";

/** Authenticated account as returned by the auth API. */
export interface Account {
  id: string;
  email: string;
  type: AccountType;
  organizationId?: string;
  displayName?: string;
  /** Linked web3 wallet address, if the account has one. */
  walletAddress?: string;
}

/** Successful auth result carrying the account and an opaque session token. */
export interface AuthSession {
  account: Account;
  sessionToken: string;
}

/** Result of requesting a magic link. devToken is only present in dev. */
export interface MagicLinkRequestResult {
  ok: true;
  devToken?: string;
}

/** Uniform result envelope returned by every client function. */
export interface AuthResult<T> {
  data: T | null;
  error: string | null;
}

/** Name of the cookie that stores the opaque session token. */
export const SESSION_COOKIE = "sk_session";

interface RegisterInput {
  email: string;
  password: string;
  type: AccountType;
  organizationId?: string;
  displayName?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

/**
 * POST a JSON payload to an auth endpoint and unwrap the { data } envelope.
 * Network failures, non-2xx responses, and error envelopes are all surfaced
 * as a populated `error` string so callers never have to catch.
 */
async function authPost<T>(
  path: string,
  payload: unknown,
  bearer?: string,
): Promise<AuthResult<T>> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (bearer) headers.authorization = `Bearer ${bearer}`;

    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const body = (await res
      .json()
      .catch(() => null)) as { data?: T; error?: string } | null;

    if (!res.ok) {
      const message =
        (body && typeof body.error === "string" && body.error) ||
        `Authentication failed (${res.status} ${res.statusText})`;
      return { data: null, error: message };
    }

    const data = body && "data" in body ? (body.data ?? null) : null;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** GET an auth endpoint with a bearer token and unwrap the { data } envelope. */
async function authGet<T>(
  path: string,
  bearer: string,
): Promise<AuthResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });

    const body = (await res
      .json()
      .catch(() => null)) as { data?: T; error?: string } | null;

    if (!res.ok) {
      const message =
        (body && typeof body.error === "string" && body.error) ||
        `Request failed (${res.status} ${res.statusText})`;
      return { data: null, error: message };
    }

    const data = body && "data" in body ? (body.data ?? null) : null;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** Register a new account. The dashboard always registers merchants. */
export function register(input: RegisterInput): Promise<AuthResult<AuthSession>> {
  return authPost<AuthSession>("/v1/auth/register", input);
}

/** Log in with email + password. */
export function login(input: LoginInput): Promise<AuthResult<AuthSession>> {
  return authPost<AuthSession>("/v1/auth/login", input);
}

/** Request a magic-link email. Returns a devToken when no mail transport. */
export function requestMagicLink(
  email: string,
): Promise<AuthResult<MagicLinkRequestResult>> {
  return authPost<MagicLinkRequestResult>("/v1/auth/magic-link/request", {
    email,
  });
}

/** Complete a magic-link sign-in by exchanging the token for a session. */
export function completeMagicLink(
  token: string,
): Promise<AuthResult<AuthSession>> {
  return authPost<AuthSession>("/v1/auth/magic-link/complete", { token });
}

/** A single-use Sign-In-With-Ethereum challenge issued by the server. */
export interface WalletNonceResult {
  nonce: string;
  address: string;
}

/** Request a single-use SIWE nonce for `address`. */
export function requestWalletNonce(
  address: string,
): Promise<AuthResult<WalletNonceResult>> {
  return authPost<WalletNonceResult>("/v1/auth/wallet/nonce", { address });
}

/** Complete a wallet sign-in by presenting the signed SIWE message. */
export function walletLogin(input: {
  message: string;
  signature: string;
  type?: AccountType;
}): Promise<AuthResult<AuthSession>> {
  return authPost<AuthSession>("/v1/auth/wallet/login", input);
}

/**
 * Link a wallet to the authenticated account (server-side: pass the session
 * token as bearer). Used by the /api/wallet/link route handler.
 */
export function linkWallet(
  bearer: string,
  input: { message: string; signature: string },
): Promise<AuthResult<{ account: Account }>> {
  return authPost<{ account: Account }>("/v1/auth/wallet/link", input, bearer);
}

/** Unlink the wallet from the authenticated account (server-side; bearer token). */
export async function unlinkWallet(
  bearer: string,
): Promise<AuthResult<{ account: Account }>> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/wallet`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { account: Account }; error?: string }
      | null;
    if (!res.ok) {
      return {
        data: null,
        error: (body && typeof body.error === "string" && body.error) || "Could not unlink wallet.",
      };
    }
    return { data: body && "data" in body ? (body.data ?? null) : null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Update mutable profile fields on the authenticated account (server-side;
 * bearer token). PATCH is not covered by the shared authPost helper, so this
 * does its own raw fetch mirroring unlinkWallet. Used by the /api/account route.
 */
export async function updateAccount(
  bearer: string,
  input: { displayName?: string },
): Promise<AuthResult<{ account: Account }>> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/account`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { account: Account }; error?: string }
      | null;
    if (!res.ok) {
      return {
        data: null,
        error: (body && typeof body.error === "string" && body.error) || "Could not update profile.",
      };
    }
    return { data: body && "data" in body ? (body.data ?? null) : null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

/** A session as shown to the account owner (no token). */
export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** List the authenticated account's active sessions (server-side; bearer token). */
export function listSessions(
  bearer: string,
): Promise<AuthResult<{ sessions: SessionSummary[] }>> {
  return authGet<{ sessions: SessionSummary[] }>("/v1/auth/sessions", bearer);
}

/** Revoke one of the account's sessions by id (server-side; bearer token). */
export async function revokeSession(
  bearer: string,
  id: string,
): Promise<AuthResult<{ ok: true }>> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { ok: true }; error?: string }
      | null;
    if (!res.ok) {
      return {
        data: null,
        error: (body && typeof body.error === "string" && body.error) || "Could not revoke session.",
      };
    }
    return { data: body && "data" in body ? (body.data ?? null) : null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

/** Fetch the account for a given session token. */
export function getSession(token: string): Promise<AuthResult<{ account: Account }>> {
  return authGet<{ account: Account }>("/v1/auth/session", token);
}

/** Invalidate a session token on the server. */
export function logout(token: string): Promise<AuthResult<{ ok: true }>> {
  return authPost<{ ok: true }>("/v1/auth/logout", {}, token);
}

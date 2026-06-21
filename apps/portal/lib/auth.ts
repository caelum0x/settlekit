// Customer authentication client for the SettleKit portal.
//
// Wraps the public /v1/auth/* endpoints described in the AUTH API CONTRACT and
// unwraps the API's `{ data }` / `{ error }` envelope. All calls run against
// NEXT_PUBLIC_API_URL (default http://localhost:8787) and never throw — they
// return a discriminated `AuthResult` so callers can render friendly errors.
//
// The opaque `sessionToken` is persisted in the "sk_session" cookie. We do NOT
// set that cookie from the browser directly: instead we POST it to the
// app/api/session route handler, which sets an httpOnly cookie the rest of the
// app can rely on. Reading the session (getSession) and logout go through the
// same route handler so the token is read from / cleared on the cookie.

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Name of the cookie that stores the opaque session token. */
export const SESSION_COOKIE = "sk_session";

/** A customer (or merchant) account as returned by /v1/auth/*. */
export interface Account {
  id: string;
  email: string;
  type: "merchant" | "customer";
  organizationId?: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  account: Account;
  sessionToken: string;
}

/** Discriminated result so every caller handles the error path explicitly. */
export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function ok<T>(data: T): AuthResult<T> {
  return { ok: true, data };
}

function fail<T>(error: string): AuthResult<T> {
  return { ok: false, error };
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Request failed";
}

/**
 * Low-level POST/GET against the API that unwraps the `{ data }` / `{ error }`
 * envelope into an AuthResult. Used for the public /v1/auth/* endpoints.
 */
async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<AuthResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: T; error?: { message?: string } | string }
      | null;

    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? errorMessage((body as { error: unknown }).error)
          : `Request failed (${res.status})`;
      return fail<T>(message);
    }
    if (body && typeof body === "object" && "data" in body) {
      return ok((body as { data: T }).data);
    }
    return fail<T>("Malformed response from server.");
  } catch (err) {
    return fail<T>(err instanceof Error ? err.message : "Network error");
  }
}

/**
 * Same envelope handling for the local /api/* route handlers (relative URLs).
 * These run on the same origin and manage the httpOnly session cookie.
 */
async function localRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<AuthResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: T; error?: { message?: string } | string }
      | null;

    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? errorMessage((body as { error: unknown }).error)
          : `Request failed (${res.status})`;
      return fail<T>(message);
    }
    if (body && typeof body === "object" && "data" in body) {
      return ok((body as { data: T }).data);
    }
    return fail<T>("Malformed response from server.");
  } catch (err) {
    return fail<T>(err instanceof Error ? err.message : "Network error");
  }
}

/**
 * Persist the session token in the httpOnly "sk_session" cookie via the local
 * route handler. Returns the account on success.
 */
export async function persistSession(
  session: AuthSession,
): Promise<AuthResult<Account>> {
  const result = await localRequest<{ account: Account }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ sessionToken: session.sessionToken }),
  });
  if (!result.ok) return result;
  // Return the account the API already gave us (authoritative for the redirect).
  return ok(session.account);
}

// ---- Public auth endpoints ----

export interface RegisterInput {
  email: string;
  password: string;
  organizationId?: string;
  displayName?: string;
}

/**
 * Register a customer account. Sets the session cookie on success and returns
 * the authenticated account.
 */
export async function register(
  input: RegisterInput,
): Promise<AuthResult<Account>> {
  const result = await apiRequest<AuthSession>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ ...input, type: "customer" }),
  });
  if (!result.ok) return result;
  return persistSession(result.data);
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Sign a customer in with email + password. Sets the session cookie on success
 * and returns the authenticated account.
 */
export async function login(input: LoginInput): Promise<AuthResult<Account>> {
  const result = await apiRequest<AuthSession>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!result.ok) return result;
  return persistSession(result.data);
}

/** A single-use Sign-In-With-Ethereum challenge issued by the server. */
export interface WalletNonceResult {
  nonce: string;
  address: string;
}

/** Request a single-use SIWE nonce for `address`. */
export async function requestWalletNonce(
  address: string,
): Promise<AuthResult<WalletNonceResult>> {
  return apiRequest<WalletNonceResult>("/v1/auth/wallet/nonce", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

/**
 * Complete a wallet sign-in (Sign-In-With-Ethereum): exchange the signed SIWE
 * message for a session and set the cookie. Portal accounts are customers.
 */
export async function walletLogin(input: {
  message: string;
  signature: string;
}): Promise<AuthResult<Account>> {
  const result = await apiRequest<AuthSession>("/v1/auth/wallet/login", {
    method: "POST",
    body: JSON.stringify({ ...input, type: "customer" }),
  });
  if (!result.ok) return result;
  return persistSession(result.data);
}

export interface MagicLinkRequestResult {
  ok: true;
  /** Present only when no email transport is configured (dev convenience). */
  devToken?: string;
}

/**
 * Request a magic-link email. When the API has no email transport configured it
 * returns a `devToken` the UI can use to complete sign-in immediately.
 */
export async function requestMagicLink(
  email: string,
): Promise<AuthResult<MagicLinkRequestResult>> {
  return apiRequest<MagicLinkRequestResult>("/v1/auth/magic-link/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Complete a magic-link sign-in by exchanging the token for a session. Sets the
 * session cookie on success and returns the authenticated account.
 */
export async function completeMagicLink(
  token: string,
): Promise<AuthResult<Account>> {
  const result = await apiRequest<AuthSession>("/v1/auth/magic-link/complete", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (!result.ok) return result;
  return persistSession(result.data);
}

/**
 * Link a wallet to the authenticated account (server-side: pass the session
 * token as bearer). Used by the /api/wallet/link route handler.
 */
export async function linkWalletWithToken(
  token: string,
  input: { message: string; signature: string },
): Promise<AuthResult<{ account: Account }>> {
  return apiRequest<{ account: Account }>("/v1/auth/wallet/link", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

/**
 * Update the authenticated account's profile (server-side: pass the session
 * token as bearer). Used by the /api/account route handler.
 */
export async function updateAccountWithToken(
  token: string,
  input: { displayName: string },
): Promise<AuthResult<{ account: Account }>> {
  return apiRequest<{ account: Account }>("/v1/auth/account", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

/**
 * Unlink the wallet from the authenticated account (server-side: pass the
 * session token as bearer). Used by the /api/wallet/link route handler.
 */
export async function unlinkWalletWithToken(
  token: string,
): Promise<AuthResult<{ account: Account }>> {
  return apiRequest<{ account: Account }>("/v1/auth/wallet", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Read the current session from the httpOnly cookie via the local route
 * handler, which forwards the stored token to GET /v1/auth/session.
 */
export async function getSession(): Promise<AuthResult<Account>> {
  const result = await localRequest<{ account: Account }>("/api/session", {
    method: "GET",
  });
  if (!result.ok) return result;
  return ok(result.data.account);
}

/**
 * Log out: clears the httpOnly cookie and revokes the session server-side via
 * the local route handler.
 */
export async function logout(): Promise<AuthResult<{ ok: true }>> {
  return localRequest<{ ok: true }>("/api/session", { method: "DELETE" });
}

/**
 * Derive the portal customer id from an authenticated account. The portal
 * routes by /c/[customerId]; the account id is the canonical customer id.
 */
export function customerIdFromAccount(account: Account): string {
  return account.id;
}

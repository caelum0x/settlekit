// Server-side session helper.
//
// Reads the httpOnly "sk_session" cookie and resolves it to an account by
// calling GET /v1/auth/session. Returns null when there is no cookie or the
// token is no longer valid. This is intentionally NOT a redirect guard —
// pages may call it to personalize, but the dashboard does not force auth so
// existing pages keep rendering.

import { cookies } from "next/headers";
import { getSession, SESSION_COOKIE, type Account } from "./auth";

/** Read the opaque session token from the httpOnly cookie, if present. */
export function getSessionToken(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolve the current account from the session cookie, or null when there is
 * no session / the token is invalid. Never throws.
 */
export async function getCurrentAccount(): Promise<Account | null> {
  const token = getSessionToken();
  if (!token) return null;

  const { data } = await getSession(token);
  return data?.account ?? null;
}

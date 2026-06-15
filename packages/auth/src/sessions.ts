import { generateSecret, isPast, uuid, type IsoTimestamp } from "@settlekit/common";
import { hashToken } from "./hash.js";
import type { AuthStore } from "./store.js";
import type { Account, Session } from "./types.js";

/** Number of random bytes of entropy in a session token. */
const TOKEN_BYTES = 32;

/** Result of a successful session-token verification. */
export interface VerifiedSession {
  account: Account;
  session: Session;
}

/** True if the session's `expiresAt` is in the past relative to `now`. */
export function isExpired(session: Session, now: Date = new Date()): boolean {
  return isPast(session.expiresAt, now);
}

/**
 * Create a new session for `accountId` valid for `ttlSec` seconds.
 *
 * Generates a high-entropy opaque token, persists only its SHA-256 hash, and
 * returns the {@link Session} carrying the plaintext `token` exactly once.
 * Callers MUST surface the token to the user immediately and never store it.
 */
export async function createSession(
  accountId: string,
  ttlSec: number,
  store: AuthStore,
  now: Date = new Date(),
): Promise<Session> {
  const token = generateSecret(TOKEN_BYTES);
  const expiresAt: IsoTimestamp = new Date(now.getTime() + ttlSec * 1000).toISOString();

  const session: Session = {
    id: uuid(),
    accountId,
    token,
    expiresAt,
    createdAt: now.toISOString(),
  };

  await store.saveSession(session, hashToken(token));
  return session;
}

/**
 * Verify a presented plaintext session token against the store.
 *
 * Hashes the token, loads the session and its owning account, and confirms the
 * session is not expired. Expired sessions are revoked as a side effect. Any
 * missing record resolves to `null` without leaking which condition failed.
 */
export async function verifySessionToken(
  plaintext: string,
  store: AuthStore,
  now: Date = new Date(),
): Promise<VerifiedSession | null> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return null;
  }

  const tokenHash = hashToken(plaintext);
  const session = await store.findSessionByHash(tokenHash);
  if (!session) {
    return null;
  }

  if (isExpired(session, now)) {
    await store.deleteSession(tokenHash);
    return null;
  }

  const account = await store.findAccountById(session.accountId);
  if (!account) {
    return null;
  }

  // Re-attach the verified plaintext token so callers have the full session.
  return { account, session: { ...session, token: plaintext } };
}

/** Revoke a session by its plaintext token. Idempotent. */
export async function revokeSession(plaintext: string, store: AuthStore): Promise<void> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return;
  }
  await store.deleteSession(hashToken(plaintext));
}

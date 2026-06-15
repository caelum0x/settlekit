import { generateSecret, isPast, uuid, type IsoTimestamp } from "@settlekit/common";
import { hashToken } from "./hash.js";
import type { AuthStore } from "./store.js";
import type { MagicLink } from "./types.js";

/** Number of random bytes of entropy in a magic-link token. */
const TOKEN_BYTES = 32;

/** Result of issuing a magic link: the record plus the one-time token. */
export interface IssuedMagicLink {
  magicLink: MagicLink;
  /** Opaque token to embed in the sign-in URL; shown to the user once. */
  token: string;
}

/** Outcome of consuming a magic link. */
export type ConsumeMagicLinkResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" };

/** True if the magic link's `expiresAt` is in the past relative to `now`. */
export function isMagicLinkExpired(magicLink: MagicLink, now: Date = new Date()): boolean {
  return isPast(magicLink.expiresAt, now);
}

/**
 * Issue a single-use magic link for `email`, valid for `ttlSec` seconds.
 *
 * Persists only the SHA-256 hash of the token; the plaintext `token` is
 * returned once for embedding in the sign-in link and never stored verbatim.
 */
export async function issueMagicLink(
  email: string,
  ttlSec: number,
  store: AuthStore,
  now: Date = new Date(),
): Promise<IssuedMagicLink> {
  const token = generateSecret(TOKEN_BYTES);
  const expiresAt: IsoTimestamp = new Date(now.getTime() + ttlSec * 1000).toISOString();

  const magicLink: MagicLink = {
    id: uuid(),
    email: email.trim().toLowerCase(),
    token,
    expiresAt,
  };

  await store.saveMagicLink(magicLink, hashToken(token));
  return { magicLink, token };
}

/**
 * Consume a magic-link token. Validates the token exists and is unexpired, then
 * atomically marks it consumed via {@link AuthStore.consumeMagicLink}. The
 * single-use guarantee is enforced by the store: a second consume returns
 * `already_consumed`. On success the verified `email` is returned so the caller
 * can find-or-create the corresponding account.
 */
export async function consumeMagicLink(
  token: string,
  store: AuthStore,
  now: Date = new Date(),
): Promise<ConsumeMagicLinkResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  const tokenHash = hashToken(token);
  const magicLink = await store.findMagicLinkByHash(tokenHash);
  if (!magicLink) {
    return { ok: false, reason: "not_found" };
  }
  if (magicLink.consumedAt !== undefined) {
    return { ok: false, reason: "already_consumed" };
  }
  if (isMagicLinkExpired(magicLink, now)) {
    return { ok: false, reason: "expired" };
  }

  const consumed = await store.consumeMagicLink(tokenHash, now.toISOString());
  if (!consumed) {
    // Lost a race to another consumer: the link was already redeemed.
    return { ok: false, reason: "already_consumed" };
  }

  return { ok: true, email: magicLink.email };
}

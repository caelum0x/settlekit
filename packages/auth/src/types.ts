import type { IsoTimestamp } from "@settlekit/common";

/** The kind of principal an account represents. */
export type AccountType = "merchant" | "customer";

/**
 * A SettleKit authentication principal. An account is the identity that owns
 * sessions and credentials; it is intentionally storage-agnostic and carries
 * no secret material itself (passwords live in {@link PasswordCredential}).
 */
export interface Account {
  id: string;
  type: AccountType;
  email: string;
  /** Set for merchant accounts that belong to an organization. */
  organizationId?: string;
  displayName?: string;
  createdAt: IsoTimestamp;
}

/**
 * A server-side session. The opaque `token` is shown to the caller exactly
 * once; only its SHA-256 hash is ever persisted (see {@link sessions}).
 */
export interface Session {
  id: string;
  accountId: string;
  /** Opaque bearer token, returned once at creation and never stored verbatim. */
  token: string;
  expiresAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}

/**
 * A single-use passwordless sign-in link. Only the SHA-256 hash of the token
 * is persisted; `consumedAt` is set the first (and only) time it is redeemed.
 */
export interface MagicLink {
  id: string;
  email: string;
  /** Opaque token, returned once at issue time and never stored verbatim. */
  token: string;
  expiresAt: IsoTimestamp;
  consumedAt?: IsoTimestamp;
}

/**
 * A password credential bound to an {@link Account}. The plaintext password is
 * never stored: only the scrypt `hash` and its random `salt` are kept.
 */
export interface PasswordCredential {
  accountId: string;
  /** Hex-encoded scrypt hash of the password. */
  hash: string;
  /** Hex-encoded random salt used to derive {@link hash}. */
  salt: string;
}

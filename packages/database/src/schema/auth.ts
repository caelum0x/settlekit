/**
 * Authentication persistence: accounts, sessions, magic links, and password
 * credentials (the `@settlekit/auth` `AuthStore` contract).
 *
 * Sessions and magic links are indexed by the SHA-256 hash of their token —
 * plaintext tokens are never stored. Every table follows the document-projection
 * pattern: the canonical `@settlekit/auth` entity lives in `metadata.__doc` and a
 * few typed columns are projected for the indexed lookups (by email / token hash
 * / account id).
 */
import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
  requiredTimestamp,
} from "./_shared.js";

/** An authentication principal (merchant or customer identity). */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: idColumn(),
    type: text("type").notNull(),
    /** Lowercased email for case-insensitive unique lookup. */
    email: text("email").notNull().unique(),
    organizationId: text("organization_id"),
    /** Lowercased wallet address for web3 (SIWE) account lookup. */
    walletAddress: text("wallet_address"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    emailIdx: index("auth_accounts_email_idx").on(table.email),
    // UNIQUE so a wallet can be linked to at most one account (NULLs allowed for
    // email-only accounts). Final DB-level gate against the link/login race.
    walletIdx: uniqueIndex("auth_accounts_wallet_address_idx").on(table.walletAddress),
  }),
);

/** A single-use Sign-In-With-Ethereum challenge, indexed by its nonce. */
export const authWalletNonces = pgTable(
  "auth_wallet_nonces",
  {
    id: idColumn(),
    /** The single-use nonce value embedded in the signed SIWE message. */
    nonce: text("nonce").notNull().unique(),
    /** Lowercased wallet address the nonce was issued to. */
    address: text("address").notNull(),
    expiresAt: requiredTimestamp("expires_at"),
    consumedAt: nullableTimestamp("consumed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    nonceIdx: index("auth_wallet_nonces_nonce_idx").on(table.nonce),
  }),
);

/** A server-side session, indexed by its token hash (plaintext never stored). */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: idColumn(),
    tokenHash: text("token_hash").notNull().unique(),
    accountId: text("account_id").notNull(),
    expiresAt: requiredTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    tokenHashIdx: index("auth_sessions_token_hash_idx").on(table.tokenHash),
    accountIdx: index("auth_sessions_account_id_idx").on(table.accountId),
  }),
);

/** A single-use passwordless sign-in link, indexed by its token hash. */
export const authMagicLinks = pgTable(
  "auth_magic_links",
  {
    id: idColumn(),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull(),
    expiresAt: requiredTimestamp("expires_at"),
    consumedAt: nullableTimestamp("consumed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    tokenHashIdx: index("auth_magic_links_token_hash_idx").on(table.tokenHash),
  }),
);

/** A scrypt password credential bound to an account (one row per account). */
export const authPasswordCredentials = pgTable(
  "auth_password_credentials",
  {
    id: idColumn(),
    accountId: text("account_id").notNull().unique(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    accountIdx: index("auth_password_credentials_account_id_idx").on(table.accountId),
  }),
);

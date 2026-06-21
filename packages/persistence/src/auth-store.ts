/**
 * Postgres-backed {@link AuthStore}. Accounts / sessions / magic links /
 * password credentials each store their canonical `@settlekit/auth` entity in
 * `metadata.__doc`; typed columns are projected for the indexed lookups (by
 * email / token hash / account id).
 *
 * Plaintext tokens are never persisted: the once-only `token` field is blanked
 * before the document is written, mirroring the in-memory reference store. Magic
 * links are single-use via an atomic `UPDATE ... WHERE consumed_at IS NULL`.
 */
import { and, eq, gt, lt, isNull, type Database, authAccounts, authSessions, authMagicLinks, authPasswordCredentials, authWalletNonces } from "@settlekit/database";
import { generateSecret } from "@settlekit/common";
import type { Account, AuthStore, MagicLink, PasswordCredential, Session, WalletNonce } from "@settlekit/auth";
import { packDoc, unpackDoc } from "./codec.js";

/** Normalize an email for case-insensitive storage + lookup. */
function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize a wallet address for case-insensitive storage + lookup. */
function walletKey(address: string): string {
  return address.trim().toLowerCase();
}

/** Strip the once-only plaintext token before persisting a session. */
function toStoredSession(session: Session): Session {
  return { ...session, token: "" };
}

/** Strip the once-only plaintext token before persisting a magic link. */
function toStoredMagicLink(magicLink: MagicLink): MagicLink {
  return { ...magicLink, token: "" };
}

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: Database) {}

  // --- accounts ---------------------------------------------------------

  async findAccountById(id: string): Promise<Account | undefined> {
    const rows = await this.db
      .select({ metadata: authAccounts.metadata })
      .from(authAccounts)
      .where(eq(authAccounts.id, id))
      .limit(1);
    return unpackDoc<Account>(rows[0]) ?? undefined;
  }

  async findAccountByEmail(email: string): Promise<Account | undefined> {
    const rows = await this.db
      .select({ metadata: authAccounts.metadata })
      .from(authAccounts)
      .where(eq(authAccounts.email, emailKey(email)))
      .limit(1);
    return unpackDoc<Account>(rows[0]) ?? undefined;
  }

  async saveAccount(account: Account): Promise<void> {
    const projection = {
      type: account.type,
      email: emailKey(account.email),
      organizationId: account.organizationId ?? null,
      walletAddress: account.walletAddress !== undefined ? walletKey(account.walletAddress) : null,
      metadata: packDoc(account),
    };
    await this.db
      .insert(authAccounts)
      .values({ id: account.id, ...projection })
      .onConflictDoUpdate({ target: authAccounts.id, set: projection });
  }

  // --- sessions ---------------------------------------------------------

  async saveSession(session: Session, tokenHash: string): Promise<void> {
    const projection = {
      tokenHash,
      accountId: session.accountId,
      expiresAt: new Date(session.expiresAt),
      metadata: packDoc(toStoredSession(session)),
    };
    await this.db
      .insert(authSessions)
      .values({ id: session.id, ...projection })
      .onConflictDoUpdate({ target: authSessions.id, set: projection });
  }

  async findSessionByHash(tokenHash: string): Promise<Session | undefined> {
    const rows = await this.db
      .select({ metadata: authSessions.metadata })
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .limit(1);
    return unpackDoc<Session>(rows[0]) ?? undefined;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }

  async listSessionsByAccount(accountId: string): Promise<readonly Session[]> {
    const rows = await this.db
      .select({ metadata: authSessions.metadata })
      .from(authSessions)
      .where(eq(authSessions.accountId, accountId));
    return rows
      .map((r) => unpackDoc<Session>(r))
      .filter((s): s is Session => s !== undefined);
  }

  async deleteSessionById(id: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.id, id));
  }

  // --- magic links ------------------------------------------------------

  async saveMagicLink(magicLink: MagicLink, tokenHash: string): Promise<void> {
    const projection = {
      tokenHash,
      email: emailKey(magicLink.email),
      expiresAt: new Date(magicLink.expiresAt),
      consumedAt: magicLink.consumedAt ? new Date(magicLink.consumedAt) : null,
      metadata: packDoc(toStoredMagicLink(magicLink)),
    };
    await this.db
      .insert(authMagicLinks)
      .values({ id: magicLink.id, ...projection })
      .onConflictDoUpdate({ target: authMagicLinks.id, set: projection });
  }

  async findMagicLinkByHash(tokenHash: string): Promise<MagicLink | undefined> {
    const rows = await this.db
      .select({ metadata: authMagicLinks.metadata, consumedAt: authMagicLinks.consumedAt })
      .from(authMagicLinks)
      .where(eq(authMagicLinks.tokenHash, tokenHash))
      .limit(1);
    const doc = unpackDoc<MagicLink>(rows[0]);
    if (!doc) return undefined;
    // The consumed_at column is the source of truth for redemption state.
    const consumedAt = rows[0]?.consumedAt;
    return consumedAt ? { ...doc, consumedAt: consumedAt.toISOString() } : doc;
  }

  async consumeMagicLink(tokenHash: string, consumedAt: string): Promise<boolean> {
    // Atomic single-use: only the first consume for an unconsumed link succeeds.
    const updated = await this.db
      .update(authMagicLinks)
      .set({ consumedAt: new Date(consumedAt) })
      .where(and(eq(authMagicLinks.tokenHash, tokenHash), isNull(authMagicLinks.consumedAt)))
      .returning({ id: authMagicLinks.id });
    return updated.length > 0;
  }

  // --- password credentials --------------------------------------------

  async getPassword(accountId: string): Promise<PasswordCredential | undefined> {
    const rows = await this.db
      .select({ metadata: authPasswordCredentials.metadata })
      .from(authPasswordCredentials)
      .where(eq(authPasswordCredentials.accountId, accountId))
      .limit(1);
    return unpackDoc<PasswordCredential>(rows[0]) ?? undefined;
  }

  async setPassword(credential: PasswordCredential): Promise<void> {
    const projection = {
      accountId: credential.accountId,
      metadata: packDoc(credential),
    };
    await this.db
      .insert(authPasswordCredentials)
      .values({ id: `apc_${generateSecret(12)}`, ...projection })
      .onConflictDoUpdate({ target: authPasswordCredentials.accountId, set: projection });
  }

  // --- web3 / Sign-In-With-Ethereum ------------------------------------

  async findAccountByWallet(address: string): Promise<Account | undefined> {
    const rows = await this.db
      .select({ metadata: authAccounts.metadata })
      .from(authAccounts)
      .where(eq(authAccounts.walletAddress, walletKey(address)))
      .limit(1);
    return unpackDoc<Account>(rows[0]) ?? undefined;
  }

  async saveWalletNonce(nonce: WalletNonce): Promise<void> {
    await this.db.insert(authWalletNonces).values({
      id: `awn_${generateSecret(12)}`,
      nonce: nonce.nonce,
      address: walletKey(nonce.address),
      expiresAt: new Date(nonce.expiresAt),
      metadata: packDoc(nonce),
    });
  }

  async consumeWalletNonce(nonce: string, address: string, consumedAt: string): Promise<boolean> {
    // Atomic single-use: only consumes a matching, unconsumed, unexpired nonce
    // bound to `address`. The WHERE guards make replay and cross-address reuse
    // impossible even under concurrent logins.
    const updated = await this.db
      .update(authWalletNonces)
      .set({ consumedAt: new Date(consumedAt) })
      .where(
        and(
          eq(authWalletNonces.nonce, nonce),
          eq(authWalletNonces.address, walletKey(address)),
          isNull(authWalletNonces.consumedAt),
          gt(authWalletNonces.expiresAt, new Date(consumedAt)),
        ),
      )
      .returning({ id: authWalletNonces.id });
    return updated.length > 0;
  }

  async pruneExpiredWalletNonces(now: string): Promise<number> {
    const removed = await this.db
      .delete(authWalletNonces)
      .where(lt(authWalletNonces.expiresAt, new Date(now)))
      .returning({ id: authWalletNonces.id });
    return removed.length;
  }
}

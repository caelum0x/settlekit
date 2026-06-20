import type { Account, MagicLink, PasswordCredential, Session, WalletNonce } from "./types.js";

/**
 * Persistence boundary for authentication state. SettleKit is storage-agnostic:
 * any backend (SQL, KV, document store) can implement this interface.
 *
 * Sessions and magic links are indexed by the SHA-256 hash of their token, never
 * the plaintext — mirroring the api-keys store contract.
 */
export interface AuthStore {
  // --- accounts ---------------------------------------------------------
  /** Find an account by id, or `undefined` if none exists. */
  findAccountById(id: string): Promise<Account | undefined>;
  /** Find an account by (case-insensitive) email, or `undefined`. */
  findAccountByEmail(email: string): Promise<Account | undefined>;
  /** Insert or replace an account, keyed by `account.id`. */
  saveAccount(account: Account): Promise<void>;

  // --- sessions ---------------------------------------------------------
  /** Persist a session indexed by its token hash. */
  saveSession(session: Session, tokenHash: string): Promise<void>;
  /** Look up a session by its token hash, or `undefined`. */
  findSessionByHash(tokenHash: string): Promise<Session | undefined>;
  /** Delete a session by its token hash. Idempotent. */
  deleteSession(tokenHash: string): Promise<void>;

  // --- magic links ------------------------------------------------------
  /** Persist a magic link indexed by its token hash. */
  saveMagicLink(magicLink: MagicLink, tokenHash: string): Promise<void>;
  /** Look up a magic link by its token hash, or `undefined`. */
  findMagicLinkByHash(tokenHash: string): Promise<MagicLink | undefined>;
  /**
   * Mark a magic link consumed at `consumedAt`. Implementations MUST be
   * single-use: only the first consume for a given hash succeeds.
   * Returns `true` if this call consumed it, `false` if already consumed
   * or unknown.
   */
  consumeMagicLink(tokenHash: string, consumedAt: string): Promise<boolean>;

  // --- password credentials --------------------------------------------
  /** Get the password credential for an account, or `undefined`. */
  getPassword(accountId: string): Promise<PasswordCredential | undefined>;
  /** Insert or replace the password credential for an account. */
  setPassword(credential: PasswordCredential): Promise<void>;

  // --- web3 / Sign-In-With-Ethereum (optional) -------------------------
  // Stores that support wallet login implement these; the AuthService web3
  // methods return `unauthorized`/`validation_error` when they are absent.
  /** Find an account by its (checksummed) wallet address, or `undefined`. */
  findAccountByWallet?(address: string): Promise<Account | undefined>;
  /** Persist a freshly issued single-use SIWE nonce. */
  saveWalletNonce?(nonce: WalletNonce): Promise<void>;
  /**
   * Atomically consume a SIWE nonce for `address`. Implementations MUST be
   * single-use: returns `true` only on the first consume of a live (unexpired,
   * unconsumed) nonce bound to `address`; `false` otherwise. This is what makes
   * wallet login replay-safe.
   */
  consumeWalletNonce?(nonce: string, address: string, consumedAt: string): Promise<boolean>;
  /**
   * Delete wallet nonces that have expired as of `now` (ISO). Bounds table
   * growth from unauthenticated nonce issuance. Returns the number removed.
   */
  pruneExpiredWalletNonces?(now: string): Promise<number>;
}

/** Strip the once-only plaintext token before persisting a session. */
function toStoredSession(session: Session): Session {
  return { ...session, token: "" };
}

/** Strip the once-only plaintext token before persisting a magic link. */
function toStoredMagicLink(magicLink: MagicLink): MagicLink {
  return { ...magicLink, token: "" };
}

/**
 * A real, fully-functional in-memory {@link AuthStore}.
 *
 * All records are stored and returned as defensive copies so callers cannot
 * mutate persisted state. Plaintext tokens are never retained: the once-only
 * `token` field is blanked on save. This is production-correct for
 * single-process usage and serves as the reference implementation.
 */
export class InMemoryAuthStore implements AuthStore {
  private readonly accountsById = new Map<string, Account>();
  private readonly accountIdByEmail = new Map<string, string>();
  private readonly accountIdByWallet = new Map<string, string>();
  private readonly sessionsByHash = new Map<string, Session>();
  private readonly magicLinksByHash = new Map<string, MagicLink>();
  private readonly passwordsByAccount = new Map<string, PasswordCredential>();
  private readonly walletNoncesByNonce = new Map<string, WalletNonce>();

  private static emailKey(email: string): string {
    return email.trim().toLowerCase();
  }

  private static walletKey(address: string): string {
    return address.trim().toLowerCase();
  }

  async findAccountById(id: string): Promise<Account | undefined> {
    const found = this.accountsById.get(id);
    return found ? { ...found } : undefined;
  }

  async findAccountByEmail(email: string): Promise<Account | undefined> {
    const id = this.accountIdByEmail.get(InMemoryAuthStore.emailKey(email));
    if (id === undefined) {
      return undefined;
    }
    return this.findAccountById(id);
  }

  async saveAccount(account: Account): Promise<void> {
    this.accountsById.set(account.id, { ...account });
    this.accountIdByEmail.set(InMemoryAuthStore.emailKey(account.email), account.id);
    if (account.walletAddress !== undefined) {
      this.accountIdByWallet.set(InMemoryAuthStore.walletKey(account.walletAddress), account.id);
    } else {
      // Unlink: drop any stale wallet-index entry still pointing at this account
      // so findAccountByWallet no longer resolves the removed wallet.
      for (const [wallet, id] of this.accountIdByWallet) {
        if (id === account.id) this.accountIdByWallet.delete(wallet);
      }
    }
  }

  async saveSession(session: Session, tokenHash: string): Promise<void> {
    this.sessionsByHash.set(tokenHash, toStoredSession(session));
  }

  async findSessionByHash(tokenHash: string): Promise<Session | undefined> {
    const found = this.sessionsByHash.get(tokenHash);
    return found ? { ...found } : undefined;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessionsByHash.delete(tokenHash);
  }

  async saveMagicLink(magicLink: MagicLink, tokenHash: string): Promise<void> {
    this.magicLinksByHash.set(tokenHash, toStoredMagicLink(magicLink));
  }

  async findMagicLinkByHash(tokenHash: string): Promise<MagicLink | undefined> {
    const found = this.magicLinksByHash.get(tokenHash);
    return found ? { ...found } : undefined;
  }

  async consumeMagicLink(tokenHash: string, consumedAt: string): Promise<boolean> {
    const found = this.magicLinksByHash.get(tokenHash);
    if (!found || found.consumedAt !== undefined) {
      return false;
    }
    this.magicLinksByHash.set(tokenHash, { ...found, consumedAt });
    return true;
  }

  async getPassword(accountId: string): Promise<PasswordCredential | undefined> {
    const found = this.passwordsByAccount.get(accountId);
    return found ? { ...found } : undefined;
  }

  async setPassword(credential: PasswordCredential): Promise<void> {
    this.passwordsByAccount.set(credential.accountId, { ...credential });
  }

  async findAccountByWallet(address: string): Promise<Account | undefined> {
    const id = this.accountIdByWallet.get(InMemoryAuthStore.walletKey(address));
    if (id === undefined) {
      return undefined;
    }
    return this.findAccountById(id);
  }

  async saveWalletNonce(nonce: WalletNonce): Promise<void> {
    this.walletNoncesByNonce.set(nonce.nonce, { ...nonce });
  }

  async consumeWalletNonce(nonce: string, address: string, consumedAt: string): Promise<boolean> {
    const found = this.walletNoncesByNonce.get(nonce);
    if (
      !found ||
      found.consumedAt !== undefined ||
      InMemoryAuthStore.walletKey(found.address) !== InMemoryAuthStore.walletKey(address) ||
      Date.parse(found.expiresAt) <= Date.parse(consumedAt)
    ) {
      return false;
    }
    this.walletNoncesByNonce.set(nonce, { ...found, consumedAt });
    return true;
  }

  async pruneExpiredWalletNonces(now: string): Promise<number> {
    const cutoff = Date.parse(now);
    let removed = 0;
    for (const [key, value] of this.walletNoncesByNonce) {
      if (Date.parse(value.expiresAt) <= cutoff) {
        this.walletNoncesByNonce.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

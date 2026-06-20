import {
  err,
  generateId,
  ok,
  SettleKitError,
  type Result,
} from "@settlekit/common";
import type { Hex } from "viem";
import { consumeMagicLink, issueMagicLink, type IssuedMagicLink } from "./magic-link.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, revokeSession, verifySessionToken } from "./sessions.js";
import type { AuthStore } from "./store.js";
import type { Account, AccountType, Session, WalletNonce } from "./types.js";
import {
  generateWalletNonce,
  normalizeWalletAddress,
  parseWalletMessage,
  recoverWalletSigner,
} from "./web3.js";

/** Default session lifetime: 7 days. */
const DEFAULT_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Default magic-link lifetime: 15 minutes. */
const DEFAULT_MAGIC_LINK_TTL_SEC = 15 * 60;

/** Default SIWE nonce lifetime: 10 minutes. */
const DEFAULT_WALLET_NONCE_TTL_SEC = 10 * 60;

/** Default max accepted age of a SIWE message from its `issuedAt`: 10 minutes. */
const DEFAULT_SIWE_MAX_AGE_SEC = 10 * 60;

/**
 * Reserved email domain for wallet-only accounts. Email registration / magic
 * links are forbidden from using it, so an attacker cannot squat a victim's
 * synthetic wallet email (`<address>@wallet.settlekit.local`) before they sign in.
 */
const WALLET_EMAIL_DOMAIN = "wallet.settlekit.local";

/** Input for registering a new password-backed account. */
export interface RegisterWithPasswordInput {
  type: AccountType;
  email: string;
  password: string;
  organizationId?: string;
  displayName?: string;
}

/** Input for a password login attempt. */
export interface LoginWithPasswordInput {
  email: string;
  password: string;
}

function unauthorized(message: string): SettleKitError {
  return new SettleKitError({ code: "unauthorized", message });
}

function validation(message: string): SettleKitError {
  return new SettleKitError({ code: "validation_error", message });
}

function conflictError(message: string): SettleKitError {
  return new SettleKitError({ code: "conflict", message });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  // Boundary check only; deep RFC validation is out of scope for auth.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** True for the reserved wallet-account email domain (cannot be registered). */
function isReservedEmail(email: string): boolean {
  return email.endsWith(`@${WALLET_EMAIL_DOMAIN}`);
}

function idForType(type: AccountType): string {
  return type === "merchant" ? generateId("merchant") : generateId("customer");
}

/**
 * High-level authentication service over an {@link AuthStore}.
 *
 * Every method returns a {@link Result} with a {@link SettleKitError} on the
 * error path (codes: `validation_error`, `unauthorized`, `conflict`) so callers
 * never have to catch exceptions for expected failures. The service is
 * stateless: all durable state lives in the injected store.
 */
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly options: {
      sessionTtlSec?: number;
      magicLinkTtlSec?: number;
      walletNonceTtlSec?: number;
      /**
       * Server's own SIWE `domain` (e.g. "app.settlekit.com"). When set, a
       * signed message whose `domain` differs is rejected — this is the
       * EIP-4361 binding that prevents a signature gathered on another site
       * from being replayed here. Strongly recommended in production.
       */
      siweDomain?: string;
      /** Allowed EVM chain ids for SIWE messages. When set, others are rejected. */
      siweChainIds?: readonly number[];
      /** Max accepted age of a SIWE message from its `issuedAt`. Default 600s. */
      siweMaxAgeSec?: number;
    } = {},
  ) {}

  private get sessionTtlSec(): number {
    return this.options.sessionTtlSec ?? DEFAULT_SESSION_TTL_SEC;
  }

  private get magicLinkTtlSec(): number {
    return this.options.magicLinkTtlSec ?? DEFAULT_MAGIC_LINK_TTL_SEC;
  }

  private get walletNonceTtlSec(): number {
    return this.options.walletNonceTtlSec ?? DEFAULT_WALLET_NONCE_TTL_SEC;
  }

  private get siweMaxAgeSec(): number {
    return this.options.siweMaxAgeSec ?? DEFAULT_SIWE_MAX_AGE_SEC;
  }

  /**
   * Verify a signed SIWE message end-to-end (shared by login + link):
   * structural fields present, server-binding (`domain`/`chainId`), time bounds
   * (`expirationTime` required, `notBefore`, `issuedAt` skew), and an EOA
   * signature whose recovered signer equals the message address. Returns the
   * checksummed address + the in-message nonce, or a `SettleKitError`. Does NOT
   * consume the nonce — the caller consumes it only after this resolves OK.
   */
  private async verifyWalletMessage(
    message: string,
    signature: Hex,
    now: Date,
  ): Promise<Result<{ address: string; nonce: string }, SettleKitError>> {
    if (typeof message !== "string" || typeof signature !== "string") {
      return err(unauthorized("Invalid wallet signature"));
    }
    const fields = parseWalletMessage(message);
    if (fields.address === undefined || fields.nonce === undefined) {
      return err(unauthorized("Invalid sign-in message"));
    }
    // EIP-4361 binding: the signature must have been produced for THIS server.
    if (this.options.siweDomain !== undefined && fields.domain !== this.options.siweDomain) {
      return err(unauthorized("Sign-in message domain does not match this site"));
    }
    if (
      this.options.siweChainIds !== undefined &&
      (fields.chainId === undefined || !this.options.siweChainIds.includes(fields.chainId))
    ) {
      return err(unauthorized("Sign-in message chain is not supported"));
    }
    // Time bounds: require a finite lifetime and reject skewed / not-yet-valid messages.
    if (fields.expirationTime === undefined) {
      return err(unauthorized("Sign-in message must set an expiration time"));
    }
    if (fields.expirationTime.getTime() <= now.getTime()) {
      return err(unauthorized("Sign-in message has expired"));
    }
    if (fields.notBefore !== undefined && now.getTime() < fields.notBefore.getTime()) {
      return err(unauthorized("Sign-in message is not yet valid"));
    }
    if (
      fields.issuedAt !== undefined &&
      now.getTime() - fields.issuedAt.getTime() > this.siweMaxAgeSec * 1000
    ) {
      return err(unauthorized("Sign-in message is too old"));
    }

    let claimed: string;
    let signer: string;
    try {
      claimed = normalizeWalletAddress(fields.address);
      signer = await recoverWalletSigner(message, signature);
    } catch {
      return err(unauthorized("Invalid wallet signature"));
    }
    if (signer !== claimed) {
      return err(unauthorized("Wallet signature does not match the message address"));
    }
    return ok({ address: claimed, nonce: fields.nonce });
  }

  /**
   * Register a new account with a password credential. Fails with `conflict`
   * if an account already exists for the email, and `validation_error` for
   * malformed input.
   */
  async registerWithPassword(
    input: RegisterWithPasswordInput,
    now: Date = new Date(),
  ): Promise<Result<Account, SettleKitError>> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email) || isReservedEmail(email)) {
      return err(validation("A valid email is required"));
    }
    if (typeof input.password !== "string" || input.password.length < 8) {
      return err(validation("Password must be at least 8 characters"));
    }
    if (input.type !== "merchant" && input.type !== "customer") {
      return err(validation("Account type must be 'merchant' or 'customer'"));
    }

    const existing = await this.store.findAccountByEmail(email);
    if (existing) {
      return err(conflictError("An account with this email already exists"));
    }

    const account: Account = {
      id: idForType(input.type),
      type: input.type,
      email,
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      createdAt: now.toISOString(),
    };

    const { hash, salt } = hashPassword(input.password);
    await this.store.saveAccount(account);
    await this.store.setPassword({ accountId: account.id, hash, salt });

    return ok(account);
  }

  /**
   * Authenticate with email + password and open a new session on success.
   * Returns `unauthorized` for unknown accounts, missing credentials, or a
   * password mismatch — without revealing which.
   */
  async loginWithPassword(
    input: LoginWithPasswordInput,
    now: Date = new Date(),
  ): Promise<Result<{ account: Account; session: Session }, SettleKitError>> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email) || typeof input.password !== "string") {
      return err(unauthorized("Invalid email or password"));
    }

    const account = await this.store.findAccountByEmail(email);
    if (!account) {
      return err(unauthorized("Invalid email or password"));
    }

    const credential = await this.store.getPassword(account.id);
    if (!credential || !verifyPassword(input.password, credential.hash, credential.salt)) {
      return err(unauthorized("Invalid email or password"));
    }

    const session = await createSession(account.id, this.sessionTtlSec, this.store, now);
    return ok({ account, session });
  }

  /**
   * Issue a passwordless magic link for `email`. Always succeeds for a
   * well-formed email (no account-existence leak); the account is created or
   * resolved at {@link completeMagicLink} time.
   */
  async requestMagicLink(
    email: string,
    now: Date = new Date(),
  ): Promise<Result<IssuedMagicLink, SettleKitError>> {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized) || isReservedEmail(normalized)) {
      return err(validation("A valid email is required"));
    }
    const issued = await issueMagicLink(normalized, this.magicLinkTtlSec, this.store, now);
    return ok(issued);
  }

  /**
   * Complete a magic-link sign-in: consume the single-use token, find-or-create
   * the account for its email (as `type`, default `customer`), and open a
   * session. Returns `unauthorized` if the token is missing, expired, or
   * already consumed.
   */
  async completeMagicLink(
    token: string,
    type: AccountType = "customer",
    now: Date = new Date(),
  ): Promise<Result<{ account: Account; session: Session }, SettleKitError>> {
    const result = await consumeMagicLink(token, this.store, now);
    if (!result.ok) {
      return err(unauthorized("Magic link is invalid or has expired"));
    }

    let account = await this.store.findAccountByEmail(result.email);
    if (!account) {
      account = {
        id: idForType(type),
        type,
        email: result.email,
        createdAt: now.toISOString(),
      };
      await this.store.saveAccount(account);
    }

    const session = await createSession(account.id, this.sessionTtlSec, this.store, now);
    return ok({ account, session });
  }

  /**
   * Issue a single-use Sign-In-With-Ethereum nonce bound to `address`. The
   * client embeds the returned nonce in a SIWE message, signs it, and presents
   * both to {@link loginWithWallet}. Returns `validation_error` for a malformed
   * address and `validation_error` when the store does not support web3.
   */
  async requestWalletNonce(
    address: string,
    now: Date = new Date(),
  ): Promise<Result<{ nonce: string; address: string }, SettleKitError>> {
    if (this.store.saveWalletNonce === undefined) {
      return err(validation("Wallet login is not supported by this store"));
    }
    let normalized: string;
    try {
      normalized = normalizeWalletAddress(address);
    } catch {
      return err(validation("A valid wallet address is required"));
    }
    // Opportunistically bound table growth: drop already-expired nonces.
    // Best-effort — a cleanup failure must not block issuing a new challenge.
    if (this.store.pruneExpiredWalletNonces !== undefined) {
      try {
        await this.store.pruneExpiredWalletNonces(now.toISOString());
      } catch {
        // ignore — cleanup is non-critical
      }
    }
    const nonce = generateWalletNonce();
    const record: WalletNonce = {
      nonce,
      address: normalized,
      expiresAt: new Date(now.getTime() + this.walletNonceTtlSec * 1000).toISOString(),
    };
    await this.store.saveWalletNonce(record);
    return ok({ nonce, address: normalized });
  }

  /**
   * Complete a Sign-In-With-Ethereum login: verify the SIWE signature, consume
   * the single-use nonce (replay-safe), find-or-create the account for the
   * recovered wallet address, and open a session. Returns `unauthorized` for a
   * bad signature, an unknown/expired/used nonce, or an address mismatch.
   */
  async loginWithWallet(
    input: { message: string; signature: Hex; type?: AccountType },
    now: Date = new Date(),
  ): Promise<Result<{ account: Account; session: Session }, SettleKitError>> {
    if (this.store.consumeWalletNonce === undefined || this.store.findAccountByWallet === undefined) {
      return err(validation("Wallet login is not supported by this store"));
    }

    const verified = await this.verifyWalletMessage(input.message, input.signature, now);
    if (!verified.ok) return err(verified.error);
    const { address: claimed, nonce } = verified.value;

    // Consume the nonce only after the signature is proven, so a bad signature
    // never burns a live challenge.
    const consumed = await this.store.consumeWalletNonce(nonce, claimed, now.toISOString());
    if (!consumed) {
      return err(unauthorized("Sign-in challenge is invalid or has expired"));
    }

    const type: AccountType = input.type ?? "customer";
    let account = await this.store.findAccountByWallet(claimed);
    if (!account) {
      account = {
        id: idForType(type),
        type,
        // Wallet accounts have no email; a stable, reserved-domain placeholder
        // keeps the email index unique. The reserved domain cannot be used for
        // email/magic-link registration (see registerWithPassword), so it can't
        // be squatted ahead of a wallet sign-in.
        email: `${claimed.toLowerCase()}@${WALLET_EMAIL_DOMAIN}`,
        walletAddress: claimed,
        createdAt: now.toISOString(),
      };
      const saved = await this.saveNewWalletAccount(account);
      if (!saved.ok) return err(saved.error);
      account = saved.value;
    }

    const session = await createSession(account.id, this.sessionTtlSec, this.store, now);
    return ok({ account, session });
  }

  /**
   * Persist a freshly-created wallet account, tolerating a concurrent creation:
   * if another request claimed the same wallet between our lookup and write
   * (a unique-constraint violation in Postgres), re-read by wallet and use the
   * winner instead of failing.
   */
  private async saveNewWalletAccount(
    account: Account,
  ): Promise<Result<Account, SettleKitError>> {
    try {
      await this.store.saveAccount(account);
      return ok(account);
    } catch (error) {
      const existing = await this.store.findAccountByWallet?.(account.walletAddress ?? "");
      if (existing) return ok(existing);
      return err(
        error instanceof SettleKitError
          ? error
          : conflictError("This wallet is already linked to another account"),
      );
    }
  }

  /**
   * Link a wallet to the already-authenticated account behind `sessionToken`.
   * Verifies the SIWE signature + single-use nonce, then attaches the recovered
   * address to the account. Returns `conflict` if the wallet is already linked
   * to a different account, `unauthorized` for a bad session/signature.
   */
  async linkWallet(
    sessionToken: string,
    input: { message: string; signature: Hex },
    now: Date = new Date(),
  ): Promise<Result<{ account: Account }, SettleKitError>> {
    if (this.store.consumeWalletNonce === undefined || this.store.findAccountByWallet === undefined) {
      return err(validation("Wallet linking is not supported by this store"));
    }

    const auth = await this.authenticateSession(sessionToken, now);
    if (!auth.ok) {
      return err(auth.error);
    }
    const { account } = auth.value;

    const verified = await this.verifyWalletMessage(input.message, input.signature, now);
    if (!verified.ok) return err(verified.error);
    const { address: claimed, nonce } = verified.value;

    // Reject before consuming the nonce if another account already owns it.
    const existing = await this.store.findAccountByWallet(claimed);
    if (existing && existing.id !== account.id) {
      return err(conflictError("This wallet is already linked to another account"));
    }
    // Idempotent: re-linking the same wallet to the same account is a no-op success.
    if (existing && existing.id === account.id) {
      const consumedSame = await this.store.consumeWalletNonce(nonce, claimed, now.toISOString());
      if (!consumedSame) return err(unauthorized("Sign-in challenge is invalid or has expired"));
      return ok({ account: existing });
    }

    const consumed = await this.store.consumeWalletNonce(nonce, claimed, now.toISOString());
    if (!consumed) {
      return err(unauthorized("Sign-in challenge is invalid or has expired"));
    }

    // Final gate against the find→save race: the DB unique constraint on
    // wallet_address makes a concurrent claim throw, which we map to `conflict`.
    const updated: Account = { ...account, walletAddress: claimed };
    try {
      await this.store.saveAccount(updated);
    } catch (error) {
      return err(
        error instanceof SettleKitError
          ? error
          : conflictError("This wallet is already linked to another account"),
      );
    }
    return ok({ account: updated });
  }

  /**
   * Unlink the wallet from the authenticated account. Refuses if the wallet is
   * the account's ONLY sign-in method (a wallet-only account with no password),
   * so a user can never lock themselves out. Idempotent when no wallet is linked.
   */
  async unlinkWallet(
    sessionToken: string,
    now: Date = new Date(),
  ): Promise<Result<{ account: Account }, SettleKitError>> {
    const auth = await this.authenticateSession(sessionToken, now);
    if (!auth.ok) return err(auth.error);
    const { account } = auth.value;

    if (account.walletAddress === undefined) {
      return ok({ account }); // nothing linked — idempotent success
    }

    const hasPassword = (await this.store.getPassword(account.id)) !== undefined;
    const walletOnly = account.email.endsWith(`@${WALLET_EMAIL_DOMAIN}`) && !hasPassword;
    if (walletOnly) {
      return err(
        validation(
          "Cannot unlink your only sign-in method — set a password or email before removing the wallet",
        ),
      );
    }

    // Drop the wallet so it can be re-linked elsewhere (Pg: column → NULL;
    // in-memory: index entry removed in saveAccount).
    const { walletAddress: _removed, ...rest } = account;
    const updated: Account = { ...rest };
    await this.store.saveAccount(updated);
    return ok({ account: updated });
  }

  /**
   * Resolve the account for a session token. Returns `unauthorized` if the
   * token is unknown, expired, or its account no longer exists.
   */
  async authenticateSession(
    token: string,
    now: Date = new Date(),
  ): Promise<Result<{ account: Account; session: Session }, SettleKitError>> {
    const verified = await verifySessionToken(token, this.store, now);
    if (!verified) {
      return err(unauthorized("Session is invalid or has expired"));
    }
    return ok(verified);
  }

  /** Revoke a session token. Idempotent; always succeeds. */
  async logout(token: string): Promise<Result<true, SettleKitError>> {
    await revokeSession(token, this.store);
    return ok(true);
  }
}

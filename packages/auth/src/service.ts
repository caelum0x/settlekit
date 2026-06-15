import {
  err,
  generateId,
  ok,
  SettleKitError,
  type Result,
} from "@settlekit/common";
import { consumeMagicLink, issueMagicLink, type IssuedMagicLink } from "./magic-link.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, revokeSession, verifySessionToken } from "./sessions.js";
import type { AuthStore } from "./store.js";
import type { Account, AccountType, Session } from "./types.js";

/** Default session lifetime: 7 days. */
const DEFAULT_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Default magic-link lifetime: 15 minutes. */
const DEFAULT_MAGIC_LINK_TTL_SEC = 15 * 60;

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
    } = {},
  ) {}

  private get sessionTtlSec(): number {
    return this.options.sessionTtlSec ?? DEFAULT_SESSION_TTL_SEC;
  }

  private get magicLinkTtlSec(): number {
    return this.options.magicLinkTtlSec ?? DEFAULT_MAGIC_LINK_TTL_SEC;
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
    if (!isValidEmail(email)) {
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
    if (!isValidEmail(normalized)) {
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

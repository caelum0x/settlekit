/**
 * Console configuration, read on the server only.
 *
 * The operator API key (OPERATOR_CONSOLE_API_KEY) never leaves the server:
 * nothing here is prefixed NEXT_PUBLIC_, and only server components, route
 * handlers and server actions import this module.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export interface ConsoleConfig {
  /** Base URL of the SettleKit API (server-to-server). */
  readonly apiUrl: string;
  /** Owner-capable API key for /v1/operator/* (bootstrap or OPERATOR_OWNER_KEY_IDS). */
  readonly apiKey: string | null;
  /** Password for the console owner login. */
  readonly ownerPassword: string | null;
  /** HMAC secret for owner session cookies (>= 32 chars). */
  readonly sessionSecret: string | null;
  /** Arc block explorer (Arcscan) base URL. */
  readonly explorerUrl: string;
  /** Hosted checkout base URL; checkout links are `${checkoutUrl}/c/:sessionId`. */
  readonly checkoutUrl: string;
  /** Agent (operator) address shown in onboarding deploy commands, if known. */
  readonly operatorAddress: string | null;
}

export const DEFAULT_API_URL = "http://localhost:8787";
export const DEFAULT_EXPLORER_URL = "https://testnet.arcscan.app";
export const DEFAULT_CHECKOUT_URL = "http://localhost:3000";
export const MIN_SECRET_LENGTH = 32;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function trimmed(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function baseUrl(value: string | null, fallback: string): string {
  return (value ?? fallback).replace(/\/+$/, "");
}

export function loadConsoleConfig(env: Env = process.env): ConsoleConfig {
  const secret = trimmed(env, "CONSOLE_SESSION_SECRET");
  const operator = trimmed(env, "OPERATOR_WALLET_ADDRESS");
  return {
    apiUrl: baseUrl(trimmed(env, "OPERATOR_API_URL"), DEFAULT_API_URL),
    apiKey: trimmed(env, "OPERATOR_CONSOLE_API_KEY"),
    ownerPassword: trimmed(env, "CONSOLE_OWNER_PASSWORD"),
    // A short secret would make session cookies forgeable; treat it as unset.
    sessionSecret: secret && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    explorerUrl: baseUrl(trimmed(env, "ARC_EXPLORER_URL"), DEFAULT_EXPLORER_URL),
    checkoutUrl: baseUrl(trimmed(env, "CHECKOUT_URL"), DEFAULT_CHECKOUT_URL),
    operatorAddress: operator && ADDRESS_RE.test(operator) ? operator : null,
  };
}

/** Whether owner login can work at all (password + strong secret). */
export function ownerLoginEnabled(config: ConsoleConfig): boolean {
  return config.ownerPassword !== null && config.sessionSecret !== null;
}

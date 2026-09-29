/**
 * Fail-closed verification of a HyperCore USDC payment through the payee's
 * ledger (`info.userNonFundingLedgerUpdates` for payTo). Rules:
 *
 *   (a) the ledger entry exists (by hash, or by the submitted action's
 *       sender + nonce) and is a USDC transfer (usdSend / send / spotSend);
 *   (b) destination == payTo;
 *   (c) amount >= expected (6-decimal base units, rounded down);
 *   (d) time >= notBefore minus {@link HYPERCORE_CLOCK_SKEW_MS};
 *   (e) when a payer is bound, the sender is that payer;
 *   (f) hash uniqueness is enforced by the caller's payment store (409).
 *
 * HyperCore blocks are final on inclusion: a found transfer has one
 * confirmation and never needs more.
 */

import { usdcTransferOf, usdToBaseUnits, type LedgerUpdate, type UsdcCredit } from "./ledger.js";

export const HYPERCORE_CLOCK_SKEW_MS = 120_000;
/** How long after its nonce a submitted usdSend may take to land in the ledger. */
export const HYPERCORE_MATCH_WINDOW_MS = 10 * 60_000;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Reads a user's non-funding ledger (the SDK in production, fixtures in tests). */
export interface HyperCoreLedgerSource {
  ledgerUpdates(user: string, startTime: number): Promise<LedgerUpdate[]>;
}

export type HyperCoreFailureCode =
  | "malformed"
  | "api_unavailable"
  | "not_found"
  | "not_usdc"
  | "wrong_destination"
  | "underpaid"
  | "too_old"
  | "payer_mismatch";

export type HyperCoreVerification =
  | { ok: true; hash: string; from: string; amountBase: bigint; time: Date; kind: UsdcCredit["kind"]; confirmations: 1 }
  | { ok: false; code: HyperCoreFailureCode; reason: string; retryable: boolean };

export interface HyperCoreVerifyParams {
  payTo: string;
  /** Minimum USDC in 6-decimal base units. */
  expectedBase: bigint;
  /** Earliest acceptable time (session creation). */
  notBefore: Date;
  /** Look the transfer up by its HyperCore hash (pasted / provider-reported). */
  txHash?: string;
  /** Or by the usdSend this checkout submitted: signer + action nonce. */
  submitted?: { sender: string; nonce: number };
  /** Declared payer: the transfer must come from it. */
  payer?: string;
}

function fail(code: HyperCoreFailureCode, reason: string, retryable = false): HyperCoreVerification {
  return { ok: false, code, reason, retryable };
}

function checkCredit(credit: UsdcCredit, params: HyperCoreVerifyParams): HyperCoreVerification {
  if (credit.to !== params.payTo.toLowerCase()) return fail("wrong_destination", "transfer does not pay the payTo address");
  if (credit.time < params.notBefore.getTime() - HYPERCORE_CLOCK_SKEW_MS) {
    return fail("too_old", "transfer happened before the checkout session was created");
  }
  if (params.payer !== undefined && credit.from !== params.payer.toLowerCase()) {
    return fail("payer_mismatch", "transfer was not sent from the declared payer");
  }
  const amountBase = usdToBaseUnits(credit.amount);
  if (amountBase === null) return fail("not_usdc", `unreadable transfer amount "${credit.amount}"`);
  if (amountBase < params.expectedBase) {
    return fail("underpaid", `received ${amountBase} base units, expected at least ${params.expectedBase}`);
  }
  return { ok: true, hash: credit.hash, from: credit.from, amountBase, time: new Date(credit.time), kind: credit.kind, confirmations: 1 };
}

function byHash(updates: readonly LedgerUpdate[], hash: string, params: HyperCoreVerifyParams): HyperCoreVerification {
  const entry = updates.find((update) => typeof update.hash === "string" && update.hash.toLowerCase() === hash);
  if (entry === undefined) return fail("not_found", "transfer not found in the payee's HyperCore ledger yet", true);
  const credit = usdcTransferOf(entry);
  if (credit === null) return fail("not_usdc", `ledger entry is a ${entry.delta.type}, not a USDC transfer`);
  return checkCredit(credit, params);
}

function bySubmission(updates: readonly LedgerUpdate[], params: HyperCoreVerifyParams): HyperCoreVerification {
  const { sender, nonce } = params.submitted as { sender: string; nonce: number };
  const from = sender.toLowerCase();
  const payTo = params.payTo.toLowerCase();
  const candidates = updates
    .map(usdcTransferOf)
    .filter((credit): credit is UsdcCredit => credit !== null && credit.from === from && credit.to === payTo)
    .filter((credit) =>
      credit.nonce !== undefined
        ? credit.nonce === nonce
        : credit.time >= nonce - HYPERCORE_CLOCK_SKEW_MS && credit.time <= nonce + HYPERCORE_MATCH_WINDOW_MS,
    )
    .sort((a, b) => Math.abs(a.time - nonce) - Math.abs(b.time - nonce));
  const first = candidates[0];
  if (first === undefined) return fail("not_found", "the submitted transfer is not in the payee's ledger yet", true);
  const checked = candidates.map((credit) => checkCredit(credit, params));
  return checked.find((result) => result.ok) ?? (checked[0] as HyperCoreVerification);
}

/** Verify a HyperCore USDC payment to `params.payTo`. Never throws. */
export async function verifyHyperCoreTransfer(
  source: HyperCoreLedgerSource,
  params: HyperCoreVerifyParams,
): Promise<HyperCoreVerification> {
  const hash = params.txHash?.trim().toLowerCase();
  if (hash !== undefined && !HASH_RE.test(hash)) return fail("malformed", "malformed HyperCore transaction hash");
  if (hash === undefined && params.submitted === undefined) return fail("malformed", "a transaction hash or submitted action is required");
  let updates: LedgerUpdate[];
  try {
    updates = await source.ledgerUpdates(params.payTo.toLowerCase(), Math.max(0, params.notBefore.getTime() - HYPERCORE_CLOCK_SKEW_MS));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("api_unavailable", `Hyperliquid API unavailable: ${message}`, true);
  }
  if (!Array.isArray(updates)) return fail("api_unavailable", "Hyperliquid API returned an unexpected ledger shape", true);
  return hash !== undefined ? byHash(updates, hash, params) : bySubmission(updates, params);
}

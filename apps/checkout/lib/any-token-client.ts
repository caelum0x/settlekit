/**
 * Client-safe helpers for the any-token checkout UI: turning provider steps
 * into EIP-1193 `eth_sendTransaction` params, waiting for receipts through
 * the buyer's wallet, and the progress copy. No server imports.
 */
import type { EvmTxRequest } from "@settlekit/routing";

import type { Eip1193Provider, Hex } from "./evm-wallet";
import type { RouteStatusState, RouteStatusView } from "./any-token";

export interface RpcTransaction {
  from: Hex;
  to: Hex;
  data: Hex;
  value: Hex;
  gas?: Hex;
  chainId: Hex;
}

function hexOf(decimal: string): Hex {
  if (!/^\d+$/.test(decimal)) throw new RangeError(`not a base-10 integer: ${decimal}`);
  return `0x${BigInt(decimal).toString(16)}`;
}

/**
 * The `eth_sendTransaction` params for a provider step. Fee fields are left
 * to the wallet (it prices gas for the current block); the provider's gas
 * limit is kept when present.
 */
export function toRpcTransaction(tx: EvmTxRequest, account: string): RpcTransaction {
  if (tx.from.toLowerCase() !== account.toLowerCase()) {
    throw new Error("The route was quoted for a different wallet. Get a new quote.");
  }
  if (!/^0x[0-9a-fA-F]*$/.test(tx.data)) throw new Error("The route returned malformed calldata.");
  return {
    from: account as Hex,
    to: tx.to as Hex,
    data: tx.data as Hex,
    value: hexOf(tx.value),
    ...(tx.gas !== undefined ? { gas: hexOf(tx.gas) } : {}),
    chainId: hexOf(String(tx.chainId)),
  };
}

const RECEIPT_POLL_MS = 2_000;
const RECEIPT_TIMEOUT_MS = 10 * 60_000;

/** Wait until the wallet's RPC reports the receipt; throws when it reverted. */
export async function waitForReceipt(
  provider: Eip1193Provider,
  hash: string,
  options: { pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? RECEIPT_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? RECEIPT_TIMEOUT_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt !== null && receipt !== undefined) {
      if (receipt.status === "0x1") return;
      throw new Error("The transaction reverted on the origin chain.");
    }
    if (Date.now() > deadline) throw new Error("The transaction is taking too long to confirm; check your wallet.");
    await sleep(pollMs);
  }
}

/** States after which the UI stops polling. */
export const FINAL_ROUTE_STATES: ReadonlySet<RouteStatusState> = new Set(["paid", "refund", "failure", "unverified"]);

/** Buyer-facing progress line for a route state. */
export function routeProgressLabel(view: Pick<RouteStatusView, "state">, networkName: string): string {
  switch (view.state) {
    case "quoted":
    case "waiting":
      return "Waiting for your payment on the origin chain…";
    case "pending":
      return "Payment received. The route provider is delivering the funds…";
    case "confirming":
      return `Delivery reported. Verifying the payment on ${networkName}…`;
    case "paid":
      return "Payment confirmed.";
    case "refund":
      return "The route could not complete and your funds were refunded.";
    case "failure":
      return "The route failed.";
    case "unverified":
      return "The delivery could not be verified.";
  }
}

/** "0.55%" from basis points. */
export function formatBps(bps: number | null): string {
  return bps === null ? "unknown" : `${(bps / 100).toFixed(2)}%`;
}

/** "$0.03" style USD. */
export function formatUsd(value: string | null): string {
  if (value === null) return "unknown";
  const number = Number(value);
  if (!Number.isFinite(number)) return "unknown";
  return number < 0.01 && number > 0 ? "< $0.01" : `$${number.toFixed(2)}`;
}

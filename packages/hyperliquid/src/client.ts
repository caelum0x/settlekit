/**
 * Hyperliquid API access through `@nktkas/hyperliquid` (MIT):
 *
 *   - ledger reads: `userNonFundingLedgerUpdates` (info endpoint)
 *   - submission of a buyer-signed `usdSend` (exchange endpoint)
 *
 * The transport is injectable so tests replay recorded responses; production
 * uses the SDK's `HttpTransport` against the configured API URL.
 */

import { HttpTransport } from "@nktkas/hyperliquid";
import { userNonFundingLedgerUpdates } from "@nktkas/hyperliquid/api/info";
import type { HyperCoreConfig } from "./env.js";
import type { LedgerUpdate } from "./ledger.js";
import type { Signature, UsdSendAction } from "./typed-data.js";
import type { HyperCoreLedgerSource } from "./verify.js";

/** The slice of the SDK transport SettleKit uses (HttpTransport satisfies it). */
export interface HyperliquidTransport {
  readonly isTestnet: boolean;
  request<T>(endpoint: "info" | "exchange", payload: unknown, signal?: AbortSignal): Promise<T>;
}

export class HyperCoreSubmitError extends Error {
  /** True when Hyperliquid refused the action (bad signature, balance, nonce); false for transport failures. */
  readonly rejected: boolean;

  constructor(message: string, rejected: boolean) {
    super(message);
    this.name = "HyperCoreSubmitError";
    this.rejected = rejected;
  }
}

export interface HyperCoreClient extends HyperCoreLedgerSource {
  readonly config: HyperCoreConfig;
  /** Submit a buyer-signed usdSend. Throws {@link HyperCoreSubmitError}. */
  submitUsdSend(action: UsdSendAction, signature: Signature): Promise<void>;
}

export interface HyperCoreClientOptions {
  transport?: HyperliquidTransport;
  /** Request timeout for the default transport (ms). */
  timeoutMs?: number;
}

function describeRejection(response: unknown): string | null {
  if (response === null || typeof response !== "object") return "unexpected response";
  const body = response as { status?: unknown; response?: unknown };
  if (body.status === "err") return typeof body.response === "string" ? body.response : "request rejected";
  if (body.status !== "ok") return "unexpected response";
  return null;
}

/** A client over the SDK transport for `config`. */
export function createHyperCoreClient(config: HyperCoreConfig, options: HyperCoreClientOptions = {}): HyperCoreClient {
  const transport: HyperliquidTransport =
    options.transport ??
    new HttpTransport({
      isTestnet: config.network === "testnet",
      apiUrl: config.apiUrl,
      timeout: options.timeoutMs ?? 10_000,
    });

  async function ledgerUpdates(user: string, startTime: number): Promise<LedgerUpdate[]> {
    const updates = await userNonFundingLedgerUpdates({ transport }, { user: user as `0x${string}`, startTime });
    return updates as unknown as LedgerUpdate[];
  }

  async function submitUsdSend(action: UsdSendAction, signature: Signature): Promise<void> {
    let response: unknown;
    try {
      response = await transport.request("exchange", { action, signature, nonce: action.time });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HyperCoreSubmitError(`Hyperliquid API unavailable: ${message}`, false);
    }
    const rejection = describeRejection(response);
    if (rejection !== null) throw new HyperCoreSubmitError(`Hyperliquid refused the transfer: ${rejection}`, true);
  }

  return { config, ledgerUpdates, submitUsdSend };
}

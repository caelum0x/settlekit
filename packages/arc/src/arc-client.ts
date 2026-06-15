/**
 * Arc (EVM USDC) settlement verification client.
 *
 * Wraps a viem public client and decodes ERC-20 `Transfer` logs from
 * transaction receipts to verify USDC settlements with 6-decimal precision.
 */

import { fromBaseUnits, money, toBaseUnits } from "@settlekit/common";
import type { Money } from "@settlekit/common";
import { decodeTransfers, normalizeAddress } from "./decode.js";
import { createViemArcRpc } from "./rpc.js";
import type { ArcRpc } from "./rpc.js";
import type {
  ArcClientConfig,
  ArcTransactionReceipt,
  Hex,
  VerifyUsdcTransferParams,
  VerifyUsdcTransferResult,
} from "./types.js";

/** Options for {@link ArcClient.waitForConfirmations}. */
export interface WaitForConfirmationsOptions {
  /** Target number of confirmations to reach. */
  confirmations: number;
  /** Polling interval in milliseconds. Defaults to 4000ms. */
  pollIntervalMs?: number;
  /** Maximum time to wait in milliseconds. Defaults to 120000ms. */
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ArcClient {
  readonly config: ArcClientConfig;
  getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null>;
  verifyUsdcTransfer(
    params: VerifyUsdcTransferParams,
  ): Promise<VerifyUsdcTransferResult>;
  getConfirmations(txHash: Hex): Promise<number>;
  waitForConfirmations(
    txHash: Hex,
    options: WaitForConfirmationsOptions,
  ): Promise<number>;
}

/**
 * Create an Arc settlement client. By default it uses a real viem public
 * client; `rpc` may be supplied to inject an alternative {@link ArcRpc}
 * implementation (e.g. an in-memory transport in tests).
 */
export function createArcClient(
  config: ArcClientConfig,
  rpc: ArcRpc = createViemArcRpc(config),
): ArcClient {
  const usdcAddress = normalizeAddress(config.usdcAddress);

  /** Compute confirmations from head and a receipt's block number. */
  function computeConfirmations(
    head: bigint,
    receiptBlock: bigint,
  ): number {
    if (head < receiptBlock) return 0;
    // Inclusive of the mining block: a tx in the head block has 1 confirmation.
    return Number(head - receiptBlock) + 1;
  }

  async function getTransactionReceipt(
    txHash: Hex,
  ): Promise<ArcTransactionReceipt | null> {
    return rpc.getTransactionReceipt(txHash);
  }

  async function getConfirmations(txHash: Hex): Promise<number> {
    const receipt = await rpc.getTransactionReceipt(txHash);
    if (receipt === null) return 0;
    const head = await rpc.getBlockNumber();
    return computeConfirmations(head, receipt.blockNumber);
  }

  async function verifyUsdcTransfer(
    params: VerifyUsdcTransferParams,
  ): Promise<VerifyUsdcTransferResult> {
    const receipt = await rpc.getTransactionReceipt(params.txHash);
    if (receipt === null || receipt.status !== "success") {
      return { confirmed: false, from: null, amount: null, confirmations: 0 };
    }

    const head = await rpc.getBlockNumber();
    const confirmations = computeConfirmations(head, receipt.blockNumber);

    const expectedTo = normalizeAddress(params.to);
    const minBase = toBaseUnitsFromMoney(params.minAmount);

    const transfers = decodeTransfers(receipt, usdcAddress);
    for (const transfer of transfers) {
      if (transfer.to !== expectedTo) continue;
      if (transfer.value < minBase) continue;
      return {
        confirmed: true,
        from: transfer.from,
        amount: money(fromBaseUnits(transfer.value), params.minAmount.currency),
        confirmations,
      };
    }

    return { confirmed: false, from: null, amount: null, confirmations };
  }

  async function waitForConfirmations(
    txHash: Hex,
    options: WaitForConfirmationsOptions,
  ): Promise<number> {
    const target = options.confirmations;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const current = await getConfirmations(txHash);
      if (current >= target) return current;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${target} confirmations of ${txHash} (got ${current})`,
        );
      }
      await delay(pollIntervalMs);
    }
  }

  return {
    config,
    getTransactionReceipt,
    verifyUsdcTransfer,
    getConfirmations,
    waitForConfirmations,
  };
}

/** Convert a {@link Money} value into bigint USDC base units. */
function toBaseUnitsFromMoney(value: Money): bigint {
  // money() validation already happened at construction; re-derive base units.
  // Importing toBaseUnits avoids floating point entirely.
  return toBaseUnits(value.amount);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

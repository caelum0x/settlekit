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
  TransferFeeEstimate,
  VerifyTokenTransferParams,
  VerifyUsdcTransferParams,
  VerifyUsdcTransferResult,
} from "./types.js";

/**
 * Scale from 18-decimal native gas accounting to the 6-decimal USDC ERC-20
 * interface: `10 ** (18 - 6)`.
 */
const NATIVE_TO_USDC_SCALE = 1_000_000_000_000n;

/** Typical gas used by an ERC-20 `transfer`; the default fee-estimate basis. */
const DEFAULT_TRANSFER_GAS = 65_000n;

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
  /**
   * Verify a transfer of any Arc stablecoin by its ERC-20 contract address
   * (USDC, EURC, USYC). Same semantics as {@link verifyUsdcTransfer} but the
   * caller chooses the token, so EURC/USYC settlements verify identically.
   */
  verifyTokenTransfer(
    params: VerifyTokenTransferParams,
  ): Promise<VerifyUsdcTransferResult>;
  /**
   * Estimate the USDC-denominated fee of a stablecoin transfer on Arc. Pass a
   * `gasLimit` to override the default ERC-20 transfer gas assumption.
   */
  estimateTransferFee(options?: {
    gasLimit?: bigint;
  }): Promise<TransferFeeEstimate>;
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

  /**
   * Core verification: find a `Transfer` of `token` to `to` of at least
   * `minAmount` in the named transaction, returning the matched transfer plus
   * the transaction's current confirmation count.
   */
  async function verifyTokenTransfer(
    params: VerifyTokenTransferParams,
  ): Promise<VerifyUsdcTransferResult> {
    const receipt = await rpc.getTransactionReceipt(params.txHash);
    if (receipt === null || receipt.status !== "success") {
      return { confirmed: false, from: null, amount: null, confirmations: 0 };
    }

    const head = await rpc.getBlockNumber();
    const confirmations = computeConfirmations(head, receipt.blockNumber);

    const expectedTo = normalizeAddress(params.to);
    const minBase = toBaseUnitsFromMoney(params.minAmount);

    const transfers = decodeTransfers(receipt, normalizeAddress(params.token));
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

  /** Verify a USDC transfer against the client's configured USDC address. */
  async function verifyUsdcTransfer(
    params: VerifyUsdcTransferParams,
  ): Promise<VerifyUsdcTransferResult> {
    return verifyTokenTransfer({
      txHash: params.txHash,
      token: usdcAddress,
      to: params.to,
      minAmount: params.minAmount,
    });
  }

  /** Estimate the USDC fee for a stablecoin transfer at current gas prices. */
  async function estimateTransferFee(
    options: { gasLimit?: bigint } = {},
  ): Promise<TransferFeeEstimate> {
    const gasLimit = options.gasLimit ?? DEFAULT_TRANSFER_GAS;
    const fees = await rpc.estimateFeesPerGas();
    const feeWei = gasLimit * fees.maxFeePerGas;
    // Arc gas is paid in USDC; native accounting is 18-decimal while the USDC
    // ERC-20 interface is 6-decimal. Convert with ceiling division so a
    // worst-case fee is never understated by sub-cent dust.
    const usdcBaseUnits =
      (feeWei + NATIVE_TO_USDC_SCALE - 1n) / NATIVE_TO_USDC_SCALE;
    return {
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      feeWei,
      fee: money(fromBaseUnits(usdcBaseUnits), "USDC"),
    };
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
    verifyTokenTransfer,
    estimateTransferFee,
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

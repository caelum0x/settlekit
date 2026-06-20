/**
 * {@link ArcPaymentClient} — the SettleKit-idiomatic facade over an injected
 * Circle App Kit client. Every method validates its request, calls the SDK,
 * normalizes the result, and returns a `Result` instead of throwing, so callers
 * handle success/failure uniformly.
 */

import { type Result, SettleKitError, err, ok, validationError } from "@settlekit/common";
import type { AppKitSdk, SdkResult } from "./sdk.js";
import {
  type BridgeRequest,
  type DepositRequest,
  type SendRequest,
  type SpendRequest,
  type SwapRequest,
  type TransferEstimate,
  type TransferKind,
  type TransferResult,
  type TransferStatus,
} from "./types.js";
import {
  firstError,
  validateAddress,
  validateAmount,
  validateBps,
  validateChain,
  validateToken,
} from "./validate.js";

/** Default token when a request omits one. */
const DEFAULT_TOKEN = "USDC";

/** Map the SDK's free-form `state` onto a normalized {@link TransferStatus}. */
export function normalizeStatus(state: string | undefined): TransferStatus {
  switch ((state ?? "").toLowerCase()) {
    case "success":
    case "completed":
    case "confirmed":
      return "success";
    case "pending":
    case "processing":
    case "submitted":
      return "pending";
    default:
      return "failed";
  }
}

/** Project a raw {@link SdkResult} into a normalized {@link TransferResult}. */
function toResult(kind: TransferKind, raw: SdkResult): TransferResult {
  const result: TransferResult = { kind, status: normalizeStatus(raw.state) };
  if (raw.txHash !== undefined) result.txHash = raw.txHash;
  if (raw.explorerUrl !== undefined) result.explorerUrl = raw.explorerUrl;
  if (raw.name !== undefined) result.operation = raw.name;
  return result;
}

/** Configuration for an {@link ArcPaymentClient}. */
export interface ArcPaymentClientConfig<A> {
  /** The injected App Kit client (`new AppKit()` or a compatible mock). */
  sdk: AppKitSdk<A>;
  /**
   * Circle kit key, required by Swap. Read from `CIRCLE_KIT_KEY` by default in
   * {@link configureAppKit}. Never logged.
   */
  kitKey?: string;
}

export class ArcPaymentClient<A> {
  private readonly sdk: AppKitSdk<A>;
  private readonly kitKey?: string;

  constructor(config: ArcPaymentClientConfig<A>) {
    this.sdk = config.sdk;
    if (config.kitKey !== undefined) this.kitKey = config.kitKey;
  }

  /** Wrap an SDK call, mapping thrown errors to a typed integration error. */
  private async run(
    kind: TransferKind,
    call: () => Promise<SdkResult>,
  ): Promise<Result<TransferResult>> {
    let raw: SdkResult;
    try {
      raw = await call();
    } catch (cause) {
      return err(
        new SettleKitError({
          code: "integration_error",
          message: `App Kit ${kind} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          retryable: true,
          cause,
          details: { kind },
        }),
      );
    }
    const result = toResult(kind, raw);
    if (result.status === "failed") {
      return err(
        new SettleKitError({
          code: "payment_failed",
          message: `App Kit ${kind} did not succeed (state: ${raw.state ?? "unknown"})`,
          details: { kind, txHash: result.txHash },
        }),
      );
    }
    return ok(result);
  }

  /** Transfer a token between wallets on one chain. */
  async send(req: SendRequest<A>): Promise<Result<TransferResult>> {
    const invalid = firstError(
      validateChain(req.chain),
      validateAddress(req.to, "to"),
      validateAmount(req.amount),
      validateToken(req.token ?? DEFAULT_TOKEN),
    );
    if (invalid !== null) return err(invalid);

    return this.run("send", () =>
      this.sdk.send({
        from: {
          adapter: req.adapter,
          chain: req.chain,
          ...(req.address !== undefined ? { address: req.address } : {}),
        },
        to: req.to,
        amount: req.amount,
        token: req.token ?? DEFAULT_TOKEN,
      }),
    );
  }

  /** Estimate the cost of a {@link send} without submitting it. */
  async estimateSend(req: SendRequest<A>): Promise<Result<TransferEstimate>> {
    const invalid = firstError(
      validateChain(req.chain),
      validateAddress(req.to, "to"),
      validateAmount(req.amount),
      validateToken(req.token ?? DEFAULT_TOKEN),
    );
    if (invalid !== null) return err(invalid);
    if (this.sdk.estimateSend === undefined) {
      return err(
        new SettleKitError({
          code: "integration_error",
          message: "the configured App Kit client does not support estimateSend",
        }),
      );
    }
    try {
      const estimate = await this.sdk.estimateSend({
        from: {
          adapter: req.adapter,
          chain: req.chain,
          ...(req.address !== undefined ? { address: req.address } : {}),
        },
        to: req.to,
        amount: req.amount,
        token: req.token ?? DEFAULT_TOKEN,
      });
      const out: TransferEstimate = {};
      if (estimate.gas !== undefined) out.gas = estimate.gas;
      if (estimate.fee !== undefined) out.fee = estimate.fee;
      if (estimate.gasPrice !== undefined) out.gasPrice = estimate.gasPrice;
      return ok(out);
    } catch (cause) {
      return err(
        new SettleKitError({
          code: "integration_error",
          message: `App Kit estimateSend failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          retryable: true,
          cause,
        }),
      );
    }
  }

  /** Move USDC across chains. */
  async bridge(req: BridgeRequest<A>): Promise<Result<TransferResult>> {
    const invalid = firstError(
      validateChain(req.fromChain, "fromChain"),
      validateChain(req.toChain, "toChain"),
      validateAmount(req.amount),
    );
    if (invalid !== null) return err(invalid);

    return this.run("bridge", () =>
      this.sdk.bridge({
        from: { adapter: req.adapter, chain: req.fromChain },
        to: { adapter: req.toAdapter ?? req.adapter, chain: req.toChain },
        amount: req.amount,
      }),
    );
  }

  /** Exchange one token for another on the same chain. Requires a kit key. */
  async swap(req: SwapRequest<A>): Promise<Result<TransferResult>> {
    const invalid = firstError(
      validateChain(req.chain),
      validateToken(req.tokenIn, "tokenIn"),
      validateToken(req.tokenOut, "tokenOut"),
      validateAmount(req.amountIn, "amountIn"),
    );
    if (invalid !== null) return err(invalid);
    if (req.tokenIn === req.tokenOut) {
      return err(validationError("tokenIn and tokenOut must differ", { token: req.tokenIn }));
    }
    const monetizationInvalid = firstError(
      req.slippageBps !== undefined ? validateBps(req.slippageBps, "slippageBps") : null,
      req.fee !== undefined ? validateBps(req.fee.bps, "fee.bps") : null,
      req.fee !== undefined ? validateAddress(req.fee.recipient, "fee.recipient") : null,
    );
    if (monetizationInvalid !== null) return err(monetizationInvalid);
    if (this.kitKey === undefined || this.kitKey.length === 0) {
      return err(
        new SettleKitError({
          code: "unauthorized",
          message: "swap requires a Circle kit key — set CIRCLE_KIT_KEY or pass kitKey to configureAppKit",
        }),
      );
    }

    const kitKey = this.kitKey;
    const config = {
      kitKey,
      ...(req.slippageBps !== undefined ? { slippageTolerance: req.slippageBps } : {}),
      ...(req.fee !== undefined ? { fee: { recipient: req.fee.recipient, bps: req.fee.bps } } : {}),
    };

    return this.run("swap", () =>
      this.sdk.swap({
        from: { adapter: req.adapter, chain: req.chain },
        tokenIn: req.tokenIn,
        tokenOut: req.tokenOut,
        amountIn: req.amountIn,
        config,
      }),
    );
  }

  /** Deposit a token into the chain-abstracted Unified Balance. */
  async deposit(req: DepositRequest<A>): Promise<Result<TransferResult>> {
    const invalid = firstError(
      validateChain(req.chain),
      validateAmount(req.amount),
      validateToken(req.token ?? DEFAULT_TOKEN),
    );
    if (invalid !== null) return err(invalid);

    return this.run("deposit", () =>
      this.sdk.unifiedBalance.deposit({
        from: { adapter: req.adapter, chain: req.chain },
        amount: req.amount,
        token: req.token ?? DEFAULT_TOKEN,
      }),
    );
  }

  /** Spend from the Unified Balance to a recipient on a destination chain. */
  async spend(req: SpendRequest<A>): Promise<Result<TransferResult>> {
    const invalid = firstError(
      validateChain(req.toChain, "toChain"),
      validateAddress(req.recipientAddress, "recipientAddress"),
      validateAmount(req.amount),
    );
    if (invalid !== null) return err(invalid);

    return this.run("spend", () =>
      this.sdk.unifiedBalance.spend({
        from: { adapter: req.adapter },
        amountIn: req.amount,
        to: {
          adapter: req.toAdapter ?? req.adapter,
          chain: req.toChain,
          recipientAddress: req.recipientAddress,
        },
      }),
    );
  }
}

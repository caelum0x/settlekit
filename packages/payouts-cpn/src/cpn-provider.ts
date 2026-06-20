/**
 * Creator fiat off-ramp via Circle Payments Network (CPN).
 *
 * This provider performs ALL real work — boundary validation, request shaping,
 * money normalization, and TOCTOU-safe idempotency keyed on the business
 * `reference` (used as the CPN idempotency key, so a retry after a timeout can
 * never double-pay). The ONLY thing gated behind a credentials check is the live
 * HTTP call: when CIRCLE_CPN_* credentials (or an http client) are absent,
 * {@link assertCredentials} throws a typed SettleKitError BEFORE any fetch.
 *
 * The CPN wire schema is not vendored in this repo, so the live call is kept
 * behind the injected {@link CpnHttpClient} seam — a thin adapter to be
 * confirmed against Circle's API before going live — rather than hardcoding an
 * unverified endpoint/payload shape. Mirrors circle-provider.ts's
 * gating-on-injected-client pattern.
 */

import {
  type Result,
  SettleKitError,
  err,
  money,
  notFound,
  ok,
  toIso,
} from "@settlekit/common";
import {
  InMemoryPayoutStore,
  payoutId,
  quoteId,
  withPayoutIdempotency,
} from "./idempotency.js";
import { feeForAmount, netAfterFee } from "./quote-math.js";
import type {
  OffRampQuote,
  OffRampQuoteRequest,
  OffRampProvider,
  PayoutReceipt,
  PayoutRequest,
  PayoutStatus,
  PayoutStore,
} from "./types.js";
import { validatePayoutRequest, validateQuoteRequest } from "./validate.js";

/** Credentials for the Circle Payments Network REST API. */
export interface CpnCredentials {
  apiKey: string;
  /** API base URL, e.g. https://api.circle.com (or the sandbox host). */
  baseUrl: string;
}

/** A quote returned by the CPN quote endpoint (adapter-mapped). */
export interface CpnQuoteResponse {
  rate: string;
  destinationAmount: string;
  /** Fee in USDC, decimal string. */
  feeUsdc: string;
  /** ISO-8601 expiry. */
  expiresAt: string;
  /** CPN's own quote id, if any. */
  quoteId?: string;
}

/** A payout transfer returned by the CPN payout endpoint (adapter-mapped). */
export interface CpnPayoutResponse {
  /** CPN transfer id. */
  transferId: string;
  /** CPN lifecycle status. */
  status: PayoutStatus;
  destinationAmount: string;
  failureReason?: string;
}

/**
 * The live HTTP seam. An adapter built from {@link CpnCredentials} implements
 * this; tests inject a vi.fn(). Both methods receive the business `reference`
 * separately so the adapter can pass it as the CPN idempotency key.
 */
export interface CpnHttpClient {
  requestQuote(input: {
    reference: string;
    amountUsdc: string;
    destinationCurrency: string;
    beneficiaryCountry: string;
  }): Promise<CpnQuoteResponse>;
  createPayout(input: {
    /** Passed by the adapter as the CPN idempotency key. */
    idempotencyKey: string;
    reference: string;
    quoteId?: string;
    amountUsdc: string;
    destinationCurrency: string;
    beneficiary: PayoutRequest["beneficiary"];
    memo?: string;
  }): Promise<CpnPayoutResponse>;
}

/** Configuration for {@link CpnOffRampProvider}. */
export interface CpnProviderConfig {
  credentials?: CpnCredentials;
  /** Injected live HTTP seam. When absent, the credential gate trips. */
  http?: CpnHttpClient;
  idempotency?: PayoutStore;
  clock?: () => Date;
}

export class CpnOffRampProvider implements OffRampProvider {
  readonly name = "cpn" as const;
  private readonly config: CpnProviderConfig;
  private readonly store: PayoutStore;
  private readonly clock: () => Date;

  constructor(config: CpnProviderConfig = {}) {
    this.config = config;
    this.store = config.idempotency ?? new InMemoryPayoutStore();
    this.clock = config.clock ?? (() => new Date());
  }

  /**
   * Gate the live network call. Throws a clear, typed integration_error when
   * the CPN credentials / http client are not configured. This is a
   * configuration error, not an expected business failure, so it THROWS rather
   * than returning err — consistent with settlement-core's circle-provider.
   */
  private assertCredentials(): CpnHttpClient {
    const { http, credentials } = this.config;
    const hasCreds =
      credentials !== undefined &&
      typeof credentials.apiKey === "string" &&
      credentials.apiKey.length > 0;
    if (http === undefined || !hasCreds) {
      throw new SettleKitError({
        code: "integration_error",
        message:
          "CIRCLE_CPN_* credentials are not configured (set CIRCLE_CPN_API_KEY and inject a CPN http client)",
      });
    }
    return http;
  }

  async quote(req: OffRampQuoteRequest): Promise<Result<OffRampQuote>> {
    const validated = validateQuoteRequest(req);
    if (!validated.ok) return validated;

    // Gate BEFORE the network call. Throws for missing config.
    const http = this.assertCredentials();

    const sourceAmount = money(req.amountUsdc);
    const response = await http.requestQuote({
      reference: req.reference,
      amountUsdc: sourceAmount.amount,
      destinationCurrency: req.destinationCurrency,
      beneficiaryCountry: req.beneficiaryCountry,
    });

    const quote: OffRampQuote = {
      id: response.quoteId ?? quoteId(),
      reference: req.reference,
      sourceAmount,
      destinationCurrency: req.destinationCurrency,
      rate: response.rate,
      destinationAmount: response.destinationAmount,
      feeUsdc: money(response.feeUsdc),
      expiresAt: response.expiresAt,
      provider: "cpn",
    };
    return ok(quote);
  }

  async initiatePayout(req: PayoutRequest): Promise<Result<PayoutReceipt>> {
    const validated = validatePayoutRequest(req);
    if (!validated.ok) return validated;

    // Gate BEFORE claiming idempotency or any network call.
    const http = this.assertCredentials();

    return withPayoutIdempotency(this.store, req, "cpn", async () => {
      const sourceAmount = money(req.amountUsdc);
      const createdAt = toIso(this.clock());
      // request.reference IS the CPN idempotency key.
      const response = await http.createPayout({
        idempotencyKey: req.reference,
        reference: req.reference,
        ...(req.quoteId !== undefined ? { quoteId: req.quoteId } : {}),
        amountUsdc: sourceAmount.amount,
        destinationCurrency: req.destinationCurrency,
        beneficiary: req.beneficiary,
        ...(req.memo !== undefined ? { memo: req.memo } : {}),
      });

      const settled = response.status === "paid";
      const receipt: PayoutReceipt = {
        id: payoutId(),
        reference: req.reference,
        amount: sourceAmount,
        destinationCurrency: req.destinationCurrency,
        destinationAmount: response.destinationAmount,
        status: response.status,
        provider: "cpn",
        cpnTransferId: response.transferId,
        ...(response.failureReason !== undefined
          ? { failureReason: response.failureReason }
          : {}),
        createdAt,
        ...(settled ? { settledAt: toIso(this.clock()) } : {}),
      };
      return ok(receipt);
    });
  }

  async getPayoutStatus(reference: string): Promise<Result<PayoutReceipt>> {
    const existing = await this.store.get(reference);
    if (existing === undefined) {
      return err(notFound(`no payout for reference ${reference}`, { reference }));
    }
    return ok(existing);
  }

  /**
   * Indicative quote fee using the same exact base-unit math as the local
   * provider. Exposed so callers can preview fees without a network round-trip.
   */
  estimateFee(amountUsdc: string): Result<{ feeUsdc: string; netUsdc: string }> {
    let amount;
    try {
      amount = money(amountUsdc);
    } catch (error) {
      return err(
        new SettleKitError({
          code: "validation_error",
          message: `amountUsdc is not a valid USDC amount: ${amountUsdc}`,
          cause: error,
        }),
      );
    }
    const fee = feeForAmount(amount);
    const net = netAfterFee(amount, fee);
    return ok({ feeUsdc: fee.amount, netUsdc: net.amount });
  }
}

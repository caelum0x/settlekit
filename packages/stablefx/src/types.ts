/**
 * Public types for `@settlekit/stablefx`.
 *
 * Two integrations live here:
 *
 *  1. **Circle Mint** — mint USDC/EURC from a fiat balance and redeem it back
 *     to fiat. These mirror Circle's `/v1/businessAccount/*` REST surface
 *     (distinct from the Web3 Services `/v1/*` surface in `@settlekit/circle`).
 *     Docs: https://developers.circle.com/circle-mint
 *
 *  2. **Arc StableFX** — on-chain stablecoin FX (USDC ⇄ EURC) settled through
 *     the Arc `FxEscrow` contract via Circle's RFQ API. Quote math is pure and
 *     lives in `fx.ts`. Docs:
 *     https://www.circle.com/blog/how-to-build-real-time-stablecoin-fx-in-your-app-with-stablefx
 */

/** Stablecoins Circle Mint can mint/redeem and StableFX can trade. */
export type StableCurrency = "USDC" | "EURC";

/**
 * A multi-currency stablecoin amount. The shared `@settlekit/common` `Money`
 * type is USDC-only, so StableFX uses this 6-decimal amount for EURC/USDC.
 * `amount` is a normalized decimal major-unit string (e.g. "100.5").
 */
export interface StableAmount {
  amount: string;
  currency: StableCurrency;
}

/* ------------------------------------------------------------------ */
/* Circle Mint                                                        */
/* ------------------------------------------------------------------ */

/** Lifecycle status of a Circle Mint transfer (mint → on-chain delivery). */
export type MintStatus = "pending" | "running" | "complete" | "failed";

/** Lifecycle status of a Circle Mint payout (redeem → fiat off-ramp). */
export type RedeemStatus = "pending" | "running" | "complete" | "failed";

/** Fiat currencies a stablecoin can be minted from / redeemed to. */
export type FiatCurrency = "USD" | "EUR";

/** Chains Circle Mint can deliver minted stablecoins to. */
export type MintChain =
  | "ETH"
  | "MATIC"
  | "ARB"
  | "BASE"
  | "AVAX"
  | "SOL"
  | "ARC";

/** Input to create a mint: deliver freshly-minted stablecoin to a chain address. */
export interface CreateMintInput {
  /** Decimal major-unit amount to mint, e.g. "1000.00". */
  amount: string;
  /** Stablecoin to mint. */
  currency: StableCurrency;
  /** Pre-registered Circle "verified blockchain" address id to deliver to. */
  destinationAddressId: string;
  /** Idempotency key forwarded to Circle (generated if omitted). */
  idempotencyKey?: string;
}

/** Input to redeem stablecoin back to fiat via a linked bank account (wire). */
export interface CreateRedeemInput {
  /** Decimal major-unit amount to redeem, e.g. "1000.00". */
  amount: string;
  /** Stablecoin being redeemed. */
  currency: StableCurrency;
  /** Pre-registered Circle wire bank-account id to pay out to. */
  bankAccountId: string;
  idempotencyKey?: string;
}

/** A normalized Circle Mint mint (transfer) returned to callers. */
export interface Mint {
  id: string;
  amount: StableAmount;
  status: MintStatus;
  /** Delivery chain, when Circle has assigned/echoed one. */
  chain?: MintChain;
  /** Destination chain address, when Circle has resolved it. */
  destinationAddress?: string;
  /** On-chain delivery transaction hash, when complete. */
  transactionHash?: string;
  createdAt: string;
  updatedAt: string;
}

/** A normalized Circle Mint redeem (payout) returned to callers. */
export interface Redeem {
  id: string;
  amount: StableAmount;
  status: RedeemStatus;
  /** Source Circle wallet the funds were debited from, when present. */
  sourceWalletId?: string;
  /** Circle payout tracking reference, when present. */
  trackingRef?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* StableFX quote math                                                */
/* ------------------------------------------------------------------ */

/**
 * An FX rate quoting `1 base` in `quote` units, e.g. base "USDC", quote
 * "EURC", rate "0.92" means 1 USDC = 0.92 EURC. The rate is an arbitrary
 * decimal string; it is applied with exact integer math (no floats).
 */
export interface FxRate {
  base: StableCurrency;
  quote: StableCurrency;
  /** Decimal rate string, e.g. "0.923456". */
  rate: string;
}

/** Rounding mode applied when converting to the quote currency's 6 decimals. */
export type FxRounding = "floor" | "ceil" | "half_even";

/** Input to compute an FX quote locally from a known rate. */
export interface FxQuoteInput {
  /** Amount to sell, in the rate's `base` currency. */
  sell: StableAmount;
  /** Rate to apply (must quote `sell.currency` as its base). */
  rate: FxRate;
  /**
   * Fee taken from the converted amount, as a decimal fraction string, e.g.
   * "0.001" = 10 bps. Applied to the quote-side amount. Defaults to "0".
   */
  feeRate?: string;
  /** Rounding for the final quote amount. Defaults to "half_even" (banker's). */
  rounding?: FxRounding;
}

/** A computed FX quote: exact buy amount, fee, and effective rate. */
export interface FxQuote {
  /** The amount being sold (echoes input `sell`). */
  sell: StableAmount;
  /** The gross converted amount before fees, in quote currency. */
  gross: StableAmount;
  /** The fee charged, in quote currency. */
  fee: StableAmount;
  /** The net amount the taker receives, in quote currency (gross − fee). */
  buy: StableAmount;
  /** The mid rate that was applied (echoes input rate). */
  rate: FxRate;
}

/* ------------------------------------------------------------------ */
/* StableFX RFQ + escrow settlement                                   */
/* ------------------------------------------------------------------ */

/**
 * A typed StableFX swap request. Because the on-chain `FxEscrow` ABI is **not
 * published** (settlement is driven by Circle's RFQ API after EIP-712 intent +
 * funding signatures, with `recordTrade`/`takerDeliver`/`makerDeliver` executed
 * server-side), this models the swap as a clean request shape rather than a
 * directly-encoded escrow transaction. See INTEGRATION NOTES in the manifest.
 */
export interface FxSwapRequest {
  /** Amount the taker sells. */
  sell: StableAmount;
  /** Currency the taker wants to buy. */
  buyCurrency: StableCurrency;
  /** Chain address that receives the bought currency. */
  recipient: `0x${string}`;
  /** The `FxEscrow` contract the swap settles through. */
  escrow: `0x${string}`;
  /** Settlement tenor; StableFX exposes "instant" PvP settlement. */
  tenor: "instant";
}

/** RFQ quote request sent to Circle's StableFX API. */
export interface StableFxQuoteRequest {
  from: StableAmount;
  to: StableCurrency;
  tenor: "instant";
}

/** RFQ quote response from Circle's StableFX API. */
export interface StableFxQuoteResource {
  id: string;
  rate: string;
  from: { currency: StableCurrency; amount: string };
  to: { currency: StableCurrency; amount: string };
  fee?: { currency: StableCurrency; amount: string };
  timestamp: string;
  expiry: string;
}

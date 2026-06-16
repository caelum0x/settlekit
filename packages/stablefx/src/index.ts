/**
 * `@settlekit/stablefx` — Circle Mint (mint/redeem USDC & EURC) + Arc StableFX
 * (on-chain stablecoin FX via the `FxEscrow` contract) for multi-currency
 * checkout.
 *
 * - Mint/redeem are real Circle Mint `/v1/businessAccount/*` REST calls behind
 *   an injectable transport.
 * - FX quote math is pure and exact (6-decimal integer arithmetic).
 * - The RFQ client (`rfq.ts`) matches Circle's published StableFX OpenAPI spec.
 * - On-chain settlement uses the REAL `FxEscrow` ABI + EIP-712 witness types,
 *   captured from the verified contract in `@settlekit/onchain`. The legacy
 *   `FxSwapRequest` (from `buildSwapRequest`) remains as a lightweight preview
 *   shape; prefer the RFQ flow + `@settlekit/onchain` for actual settlement.
 */

export { createStableFxClient, stableTokenAddress } from "./client.js";
export type {
  StableFxClient,
  StableFxClientConfig,
  BuildSwapRequestInput,
} from "./client.js";

export { computeFxQuote, invertFxRate } from "./fx.js";

export { createRfqClient } from "./rfq.js";
export type {
  RfqClient,
  RfqClientConfig,
  Tenor,
  QuoteType,
  TradeStatus,
  CurrencyAmount,
  TradeTypedData,
  CreateQuoteInput,
  Quote,
  CreateTradeInput,
  Trade,
  RegisterMakerSignatureInput,
} from "./rfq.js";

export {
  createMintClient,
  createFetchMintHttp,
  buildMintUrl,
  DEFAULT_CIRCLE_MINT_BASE_URL,
} from "./mint.js";
export type {
  MintClient,
  MintClientConfig,
  MintHttp,
  MintRequest,
  MintResponse,
  FetchMintHttpOptions,
} from "./mint.js";

export type {
  StableCurrency,
  StableAmount,
  FiatCurrency,
  MintChain,
  MintStatus,
  RedeemStatus,
  CreateMintInput,
  CreateRedeemInput,
  Mint,
  Redeem,
  FxRate,
  FxRounding,
  FxQuoteInput,
  FxQuote,
  FxSwapRequest,
  StableFxQuoteRequest,
  StableFxQuoteResource,
} from "./types.js";

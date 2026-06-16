/**
 * `createStableFxClient` — the public entrypoint for `@settlekit/stablefx`.
 *
 * Bundles two capabilities behind one client:
 *  - **Circle Mint** mint/redeem of USDC & EURC (delegated to {@link MintClient}).
 *  - **StableFX** pure FX quote math + a typed escrow {@link FxSwapRequest}
 *    builder targeting the Arc `FxEscrow` contract.
 */

import { ARC_TESTNET } from "@settlekit/arc";
import { SettleKitError } from "@settlekit/common";
import { computeFxQuote } from "./fx.js";
import { createMintClient } from "./mint.js";
import type { MintClient, MintClientConfig, MintHttp } from "./mint.js";
import type {
  CreateMintInput,
  CreateRedeemInput,
  FxQuote,
  FxQuoteInput,
  FxSwapRequest,
  Mint,
  Redeem,
  StableAmount,
  StableCurrency,
} from "./types.js";

export interface StableFxClientConfig {
  /** Circle Mint API key (required unless an `http` transport is injected). */
  apiKey?: string;
  /** Override the Circle Mint base URL. */
  baseUrl?: string;
  /** Inject a custom Circle Mint transport (e.g. in-memory for tests). */
  http?: MintHttp;
  /** Inject a custom fetch (only used when `http` is not provided). */
  fetchImpl?: typeof fetch;
  /**
   * Address of the Arc `FxEscrow` contract swaps settle through. Defaults to
   * the published Arc testnet `FxEscrow` from `@settlekit/arc`.
   */
  escrowAddress?: `0x${string}`;
}

/** Input for building a StableFX swap request from a local quote. */
export interface BuildSwapRequestInput {
  /** A quote previously produced by {@link StableFxClient.quote}. */
  quote: FxQuote;
  /** Chain address that receives the bought currency. */
  recipient: `0x${string}`;
}

export interface StableFxClient {
  /* Circle Mint */
  createMint(input: CreateMintInput): Promise<Mint>;
  getMint(id: string): Promise<Mint>;
  createRedeem(input: CreateRedeemInput): Promise<Redeem>;
  getRedeem(id: string): Promise<Redeem>;

  /* StableFX */
  /** Compute an FX quote locally from a known rate (pure, no I/O). */
  quote(input: FxQuoteInput): FxQuote;
  /**
   * Build a lightweight typed {@link FxSwapRequest} preview for the configured
   * `FxEscrow`. For real settlement use the RFQ flow (`createRfqClient`) +
   * `@settlekit/onchain` (the verified `FxEscrow` ABI + EIP-712 witness types).
   */
  buildSwapRequest(input: BuildSwapRequestInput): FxSwapRequest;

  /** The `FxEscrow` address this client settles swaps through. */
  readonly escrowAddress: `0x${string}`;
}

/** Token addresses for the supported stablecoins on the configured chain. */
export function stableTokenAddress(currency: StableCurrency): `0x${string}` {
  const token = ARC_TESTNET.tokens[currency];
  return token.address as `0x${string}`;
}

export function createStableFxClient(config: StableFxClientConfig): StableFxClient {
  const mintConfig: MintClientConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    http: config.http,
    fetchImpl: config.fetchImpl,
  };
  const mint: MintClient = createMintClient(mintConfig);
  const escrowAddress = (config.escrowAddress ??
    (ARC_TESTNET.contracts.fxEscrow as `0x${string}`)) as `0x${string}`;

  return {
    escrowAddress,

    createMint: (input) => mint.createMint(input),
    getMint: (id) => mint.getMint(id),
    createRedeem: (input) => mint.createRedeem(input),
    getRedeem: (id) => mint.getRedeem(id),

    quote(input: FxQuoteInput): FxQuote {
      return computeFxQuote(input);
    },

    buildSwapRequest(input: BuildSwapRequestInput): FxSwapRequest {
      const { quote, recipient } = input;
      assertRecipient(recipient);
      const sell: StableAmount = quote.sell;
      const buyCurrency = quote.buy.currency;
      if (buyCurrency === sell.currency) {
        throw new SettleKitError({
          code: "validation_error",
          message: "StableFX swap sell and buy currencies must differ",
        });
      }
      return {
        sell,
        buyCurrency,
        recipient,
        escrow: escrowAddress,
        tenor: "instant",
      };
    },
  };
}

function assertRecipient(recipient: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Invalid recipient address: ${JSON.stringify(recipient)}`,
    });
  }
}

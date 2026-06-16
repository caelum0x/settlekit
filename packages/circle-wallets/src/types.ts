/**
 * TypeScript shapes for Circle's Web3 Services (W3S) **developer-controlled
 * wallets** REST API.
 *
 * These mirror the documented request/response envelopes at
 * https://developers.circle.com/w3s. Circle wraps every successful response in
 * a top-level `{ data: ... }` object and reports failures with
 * `{ code, message }` (sometimes with an `errors` array).
 *
 * IMPORTANT — entity secret: every mutating call (create wallet set, create
 * wallets, create transfer) requires an `entitySecretCiphertext`: a base64
 * RSA-encrypted ciphertext of your registered entity secret, **regenerated for
 * each request**. This package never stores, derives, or encrypts the entity
 * secret — callers supply the ciphertext per call (or an injected provider).
 */

/** Blockchains Circle W3S exposes for developer-controlled wallets. */
export type CircleBlockchain =
  | "ETH"
  | "ETH-SEPOLIA"
  | "MATIC"
  | "MATIC-AMOY"
  | "AVAX"
  | "AVAX-FUJI"
  | "ARB"
  | "ARB-SEPOLIA"
  | "BASE"
  | "BASE-SEPOLIA"
  | "OP"
  | "OP-SEPOLIA"
  | "SOL"
  | "SOL-DEVNET"
  | "UNI"
  | "UNI-SEPOLIA";

/** Account model for a wallet: externally owned account or smart-contract account. */
export type CircleAccountType = "EOA" | "SCA";

/** Custody model. Developer-controlled wallets are always `DEVELOPER`. */
export type CircleCustodyType = "DEVELOPER" | "ENDUSER";

/** Lifecycle state of a wallet. */
export type CircleWalletState = "LIVE" | "FROZEN";

/**
 * Lifecycle state of a W3S transaction. Terminal success is `COMPLETE`;
 * terminal failure is one of `FAILED` / `CANCELLED` / `DENIED`.
 */
export type CircleTransactionState =
  | "INITIATED"
  | "QUEUED"
  | "SENT"
  | "CONFIRMED"
  | "COMPLETE"
  | "FAILED"
  | "CANCELLED"
  | "DENIED"
  | "ACCELERATED";

/** Dynamic gas fee level for a transaction. */
export type CircleFeeLevel = "LOW" | "MEDIUM" | "HIGH";

/** A wallet set groups wallets under one HD key. */
export interface CircleWalletSet {
  id: string;
  name?: string;
  custodyType: CircleCustodyType;
  createDate: string;
  updateDate: string;
}

/** A developer-controlled wallet as returned by Circle (inside `data`). */
export interface CircleWalletResource {
  id: string;
  address: string;
  blockchain: CircleBlockchain;
  walletSetId: string;
  custodyType: CircleCustodyType;
  accountType: CircleAccountType;
  state: CircleWalletState;
  createDate: string;
  updateDate: string;
  name?: string;
  refId?: string;
}

/** A token descriptor embedded in a balance entry. */
export interface CircleToken {
  id: string;
  blockchain: CircleBlockchain;
  /** ERC-20 contract address; absent for the native gas token. */
  tokenAddress?: string;
  standard?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  isNative: boolean;
  updateDate?: string;
  createDate?: string;
}

/** A single token balance for a wallet. */
export interface CircleTokenBalance {
  token: CircleToken;
  /** Decimal major-unit amount as a string, e.g. "12.5". */
  amount: string;
  updateDate?: string;
}

/** A developer-controlled transaction as returned by Circle (inside `data`). */
export interface CircleTransactionResource {
  id: string;
  blockchain: CircleBlockchain;
  walletId?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  tokenId?: string;
  /** Transfer amounts (decimal strings); index-aligned with token IDs. */
  amounts?: string[];
  state: CircleTransactionState;
  transactionType?: string;
  /** On-chain hash once broadcast. */
  txHash?: string;
  feeLevel?: CircleFeeLevel;
  refId?: string;
  createDate: string;
  updateDate: string;
  /** Present when the transaction failed. */
  errorReason?: string;
  errorDetails?: string;
}

/** Circle's success envelope: `{ data: T }`. */
export interface CircleWalletsEnvelope<T> {
  data: T;
}

/** Circle's error envelope: `{ code, message }`, sometimes with `errors`. */
export interface CircleWalletsErrorBody {
  code?: number | string;
  message?: string;
  errors?: Array<{
    error?: string;
    message?: string;
    location?: string;
    invalidValue?: unknown;
    constraints?: Record<string, unknown>;
  }>;
}

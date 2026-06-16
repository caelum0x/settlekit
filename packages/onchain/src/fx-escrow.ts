/**
 * StableFX on-chain settlement via Arc `FxEscrow`.
 *
 * Everything here is sourced from the VERIFIED on-chain contract (not guessed):
 * the ABI is captured in `fx-escrow-abi.ts`, and the EIP-712 witness type
 * strings + Permit2 address below were read live from the contract's
 * `SINGLE_TRADE_WITNESS_TYPE()` / `TAKER_DETAILS_WITNESS_TYPE()` /
 * `MAKER_DETAILS_WITNESS_TYPE()` / `permit2()` getters on Arc testnet.
 *
 * Flow: taker + maker each sign a Permit2 `PermitWitnessTransferFrom` whose
 * witness is the trade `Consideration`; a relayer calls `recordTrade`, then
 * `takerDeliver` / `makerDeliver` settle, or `breach` unwinds.
 */
import { encodeFunctionData, getAddress, isAddress } from "viem";
import { SettleKitError } from "@settlekit/common";
import { FX_ESCROW_ABI } from "./fx-escrow-abi.js";
import type { Hex } from "./escrow.js";

/** Arc testnet FxEscrow proxy (the address calls go through). */
export const FX_ESCROW_TESTNET = "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8" as const;
/** Canonical Permit2 (read from `FxEscrow.permit2()`; same on every chain). */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * EIP-712 witness type strings, verbatim from the on-chain getters. The trade
 * terms (`Consideration`) are the witness carried by each party's Permit2
 * signature.
 */
export const FX_WITNESS_TYPES = {
  singleTrade: "SingleTradeWitness(uint256 id)",
  taker:
    "Consideration(bytes32 quoteId,address base,address quote,uint256 baseAmount,uint256 quoteAmount,uint256 maturity)" +
    "TakerDetails(Consideration consideration,address recipient,uint256 fee)" +
    "TokenPermissions(address token,uint256 amount)",
  maker:
    "Consideration(bytes32 quoteId,address base,address quote,uint256 baseAmount,uint256 quoteAmount,uint256 maturity)" +
    "MakerDetails(Consideration consideration,uint256 fee)" +
    "TokenPermissions(address token,uint256 amount)",
} as const;

/** The FX trade terms both parties sign over (witness struct). */
export interface Consideration {
  quoteId: Hex;
  base: Hex;
  quote: Hex;
  baseAmount: bigint;
  quoteAmount: bigint;
  maturity: bigint;
}

/**
 * EIP-712 struct definitions (viem `signTypedData` `types` form) for building a
 * taker's / maker's witness. `PermitWitnessTransferFrom` is Permit2's standard
 * outer type; `witness` is `TakerDetails` / `MakerDetails`.
 */
export const FX_EIP712_TYPES = {
  Consideration: [
    { name: "quoteId", type: "bytes32" },
    { name: "base", type: "address" },
    { name: "quote", type: "address" },
    { name: "baseAmount", type: "uint256" },
    { name: "quoteAmount", type: "uint256" },
    { name: "maturity", type: "uint256" },
  ],
  TakerDetails: [
    { name: "consideration", type: "Consideration" },
    { name: "recipient", type: "address" },
    { name: "fee", type: "uint256" },
  ],
  MakerDetails: [
    { name: "consideration", type: "Consideration" },
    { name: "fee", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

export interface FxEscrowTxRequest {
  to: Hex;
  data: Hex;
  value: bigint;
}

function escrowAddr(escrow?: string): Hex {
  const a = escrow ?? FX_ESCROW_TESTNET;
  if (!isAddress(a)) {
    throw new SettleKitError({ code: "validation_error", message: "FxEscrow address invalid" });
  }
  return getAddress(a);
}

/** Settle/unwind a single trade by id (relayer/keeper op). */
export function buildBreachTx(tradeId: bigint, escrow?: string): FxEscrowTxRequest {
  return {
    to: escrowAddr(escrow),
    data: encodeFunctionData({ abi: FX_ESCROW_ABI, functionName: "breach", args: [tradeId] }),
    value: 0n,
  };
}

/** Settle/unwind a batch of trades. */
export function buildBatchBreachTx(tradeIds: bigint[], escrow?: string): FxEscrowTxRequest {
  return {
    to: escrowAddr(escrow),
    data: encodeFunctionData({ abi: FX_ESCROW_ABI, functionName: "batchBreach", args: [tradeIds] }),
    value: 0n,
  };
}

/** Read calldata for `getTradeDetails(tradeId)`. */
export function encodeGetTradeDetails(tradeId: bigint): Hex {
  return encodeFunctionData({ abi: FX_ESCROW_ABI, functionName: "getTradeDetails", args: [tradeId] });
}

/** Read calldata for `lastTradeId()`. */
export function encodeLastTradeId(): Hex {
  return encodeFunctionData({ abi: FX_ESCROW_ABI, functionName: "lastTradeId", args: [] });
}

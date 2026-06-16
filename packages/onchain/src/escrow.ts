/**
 * Signer-agnostic transaction builders for `SettleKitEscrow`.
 *
 * Like the CCTP / Gateway clients, these only produce unsigned `{to,data,value}`
 * requests — the caller (a merchant/buyer wallet, a Circle programmable wallet,
 * etc.) signs and broadcasts. No keys are held here.
 */
import { encodeFunctionData, getAddress, isAddress, keccak256, toHex } from "viem";
import { SettleKitError } from "@settlekit/common";
import { ERC20_APPROVE_ABI, SETTLEKIT_ESCROW_ABI } from "./abi.js";

export type Hex = `0x${string}`;

/** An unsigned EVM transaction request. */
export interface EscrowTxRequest {
  to: Hex;
  data: Hex;
  /** Always 0n — escrow funding moves USDC via `transferFrom`, not native value. */
  value: bigint;
}

/** Escrow lifecycle states (mirrors `SettleKitEscrow.State`). */
export const ESCROW_STATE = ["None", "Funded", "Disputed", "Released", "Refunded"] as const;
export type EscrowState = (typeof ESCROW_STATE)[number];

/** Derive a `bytes32` escrow id from an arbitrary string, or pass a 0x hash through. */
export function escrowId(value: string): Hex {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value as Hex;
  return keccak256(toHex(value));
}

function requireAddress(value: string, field: string): Hex {
  if (!isAddress(value)) {
    throw new SettleKitError({ code: "validation_error", message: `${field} must be a 0x address` });
  }
  return getAddress(value);
}

function tx(escrow: string, data: Hex): EscrowTxRequest {
  return { to: requireAddress(escrow, "escrow"), data, value: 0n };
}

/** Buyer funds a new escrow (requires a prior USDC `approve` of the escrow). */
export function buildCreateAndFundTx(
  escrow: string,
  input: { id: string; seller: string; arbiter: string; amount: bigint },
): EscrowTxRequest {
  return tx(
    escrow,
    encodeFunctionData({
      abi: SETTLEKIT_ESCROW_ABI,
      functionName: "createAndFund",
      args: [
        escrowId(input.id),
        requireAddress(input.seller, "seller"),
        requireAddress(input.arbiter, "arbiter"),
        input.amount,
      ],
    }),
  );
}

/** Release to the seller (buyer or arbiter). */
export function buildReleaseTx(escrow: string, id: string): EscrowTxRequest {
  return tx(escrow, encodeFunctionData({ abi: SETTLEKIT_ESCROW_ABI, functionName: "release", args: [escrowId(id)] }));
}

/** Refund to the buyer (seller or arbiter). */
export function buildRefundTx(escrow: string, id: string): EscrowTxRequest {
  return tx(escrow, encodeFunctionData({ abi: SETTLEKIT_ESCROW_ABI, functionName: "refund", args: [escrowId(id)] }));
}

/** Raise a dispute (buyer or seller). */
export function buildDisputeTx(escrow: string, id: string): EscrowTxRequest {
  return tx(escrow, encodeFunctionData({ abi: SETTLEKIT_ESCROW_ABI, functionName: "dispute", args: [escrowId(id)] }));
}

/** ERC-20 `approve(spender, amount)` — e.g. the buyer approving the escrow for USDC. */
export function buildErc20ApproveTx(token: string, spender: string, amount: bigint): EscrowTxRequest {
  return {
    to: requireAddress(token, "token"),
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [requireAddress(spender, "spender"), amount],
    }),
    value: 0n,
  };
}

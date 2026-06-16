/**
 * @settlekit/onchain — ABIs + signer-agnostic tx-builders for the SettleKit Arc
 * contracts (see `/contracts`). Build unsigned transactions for a wallet to sign.
 */
export { SETTLEKIT_ESCROW_ABI, SETTLEKIT_CCTP_HOOK_ABI, ERC20_APPROVE_ABI } from "./abi.js";
export {
  buildCreateAndFundTx,
  buildReleaseTx,
  buildRefundTx,
  buildDisputeTx,
  buildErc20ApproveTx,
  escrowId,
  ESCROW_STATE,
} from "./escrow.js";
export type { EscrowTxRequest, EscrowState, Hex } from "./escrow.js";

export { FX_ESCROW_ABI } from "./fx-escrow-abi.js";
export {
  FX_ESCROW_TESTNET,
  PERMIT2_ADDRESS,
  FX_WITNESS_TYPES,
  FX_EIP712_TYPES,
  buildBreachTx,
  buildBatchBreachTx,
  encodeGetTradeDetails,
  encodeLastTradeId,
} from "./fx-escrow.js";
export type { Consideration, FxEscrowTxRequest } from "./fx-escrow.js";

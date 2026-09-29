/**
 * Minimal ABIs for the contracts onchain billing calls, transcribed from the
 * verified sources: base/commerce-payments v1.1.0 (src/AuthCaptureEscrow.sol,
 * src/collectors/*), coinbase/spend-permissions (src/SpendPermissionManager.sol)
 * and Uniswap Permit2 (src/interfaces/IAllowanceTransfer.sol).
 */
import { parseAbi } from "viem";

const PAYMENT_INFO_STRUCT =
  "struct PaymentInfo { address operator; address payer; address receiver; address token; uint120 maxAmount; uint48 preApprovalExpiry; uint48 authorizationExpiry; uint48 refundExpiry; uint16 minFeeBps; uint16 maxFeeBps; address feeReceiver; uint256 salt; }";

export const authCaptureEscrowAbi = parseAbi([
  PAYMENT_INFO_STRUCT,
  "function PAYMENT_INFO_TYPEHASH() view returns (bytes32)",
  "function getHash(PaymentInfo paymentInfo) view returns (bytes32)",
  "function getTokenStore(address operator) view returns (address)",
  "function paymentState(bytes32 paymentInfoHash) view returns (bool hasCollectedPayment, uint120 capturableAmount, uint120 refundableAmount)",
  "function authorize(PaymentInfo paymentInfo, uint256 amount, address tokenCollector, bytes collectorData)",
  "function charge(PaymentInfo paymentInfo, uint256 amount, address tokenCollector, bytes collectorData, uint256 feeAmount, address feeReceiver)",
  "function capture(PaymentInfo paymentInfo, uint256 amount, uint256 feeAmount, address feeReceiver)",
  "function void(PaymentInfo paymentInfo)",
  "function reclaim(PaymentInfo paymentInfo)",
  "function refund(PaymentInfo paymentInfo, uint256 amount, address tokenCollector, bytes collectorData)",
]);

export const preApprovalCollectorAbi = parseAbi([
  PAYMENT_INFO_STRUCT,
  "function preApprove(PaymentInfo paymentInfo)",
  "function isPreApproved(bytes32 paymentInfoHash) view returns (bool)",
]);

const SPEND_PERMISSION_STRUCT =
  "struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }";

export const spendPermissionManagerAbi = parseAbi([
  SPEND_PERMISSION_STRUCT,
  "struct PeriodSpend { uint48 start; uint48 end; uint160 spend; }",
  "function getHash(SpendPermission spendPermission) view returns (bytes32)",
  "function approveWithSignature(SpendPermission spendPermission, bytes signature) returns (bool)",
  "function revoke(SpendPermission spendPermission)",
  "function revokeAsSpender(SpendPermission spendPermission)",
  "function spend(SpendPermission spendPermission, uint160 value)",
  "function isApproved(SpendPermission spendPermission) view returns (bool)",
  "function isRevoked(SpendPermission spendPermission) view returns (bool)",
  "function isValid(SpendPermission spendPermission) view returns (bool)",
  "function getCurrentPeriod(SpendPermission spendPermission) view returns (PeriodSpend)",
]);

export const permit2Abi = parseAbi([
  "struct PermitDetails { address token; uint160 amount; uint48 expiration; uint48 nonce; }",
  "struct PermitSingle { PermitDetails details; address spender; uint256 sigDeadline; }",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function permit(address owner, PermitSingle permitSingle, bytes signature)",
  "function transferFrom(address from, address to, uint160 amount, address token)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/**
 * base/commerce-payments v1.1.0 (MIT, audited) on Base mainnet + Base Sepolia.
 *
 * AuthCaptureEscrow holds a payer's funds between authorization and capture,
 * and lets the operator refund captured funds back to the payer. SettleKit is
 * the operator (one hot key). This module provides:
 *   - PaymentInfo construction/validation and the contract-exact hash
 *     (`getHash` = keccak256(abi.encode(chainid, escrow, keccak256(abi.encode(TYPEHASH, info))))),
 *   - the typed data the BUYER signs for each collector
 *     (ERC-3009 ReceiveWithAuthorization or Permit2 PermitTransferFrom),
 *     plus calldata for payer-only calls (PreApproval `preApprove`, `reclaim`),
 *   - {@link CommerceEscrowClient}: authorize / charge / capture / void /
 *     refund with the operator key.
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toBytes,
  zeroAddress,
  type TypedDataDefinition,
} from "viem";
import type { Hex } from "@settlekit/chains";
import { authCaptureEscrowAbi, erc20Abi, preApprovalCollectorAbi } from "./abis.js";
import { COMMERCE_PAYMENTS_V1_1, PERMIT2_ADDRESS, commercePaymentsFor, type CommercePaymentsContracts } from "./addresses.js";
import { writeAndConfirm, type EvmOperator, type TxReceipt } from "./evm.js";

export const PAYMENT_INFO_TYPE =
  "PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)";

export const PAYMENT_INFO_TYPEHASH: Hex = keccak256(toBytes(PAYMENT_INFO_TYPE));

const UINT120_MAX = (1n << 120n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const MAX_BPS = 10_000;

export interface PaymentInfo {
  operator: Hex;
  payer: Hex;
  receiver: Hex;
  token: Hex;
  maxAmount: bigint;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: Hex;
  salt: bigint;
}

/** JSON-safe PaymentInfo (bigints as decimal strings). */
export interface PaymentInfoJson {
  operator: string;
  payer: string;
  receiver: string;
  token: string;
  maxAmount: string;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: string;
  salt: string;
}

export function paymentInfoToJson(info: PaymentInfo): PaymentInfoJson {
  return { ...info, maxAmount: info.maxAmount.toString(), salt: info.salt.toString() };
}

export function paymentInfoFromJson(json: PaymentInfoJson): PaymentInfo {
  return {
    operator: json.operator as Hex,
    payer: json.payer as Hex,
    receiver: json.receiver as Hex,
    token: json.token as Hex,
    maxAmount: BigInt(json.maxAmount),
    preApprovalExpiry: json.preApprovalExpiry,
    authorizationExpiry: json.authorizationExpiry,
    refundExpiry: json.refundExpiry,
    minFeeBps: json.minFeeBps,
    maxFeeBps: json.maxFeeBps,
    feeReceiver: json.feeReceiver as Hex,
    salt: BigInt(json.salt),
  };
}

/** The contract's validation rules, checked before we ask anyone to sign. */
export function validatePaymentInfo(info: PaymentInfo): void {
  if (info.maxAmount <= 0n || info.maxAmount > UINT120_MAX) throw new RangeError("maxAmount must be in (0, 2^120)");
  for (const [name, value] of [
    ["preApprovalExpiry", info.preApprovalExpiry],
    ["authorizationExpiry", info.authorizationExpiry],
    ["refundExpiry", info.refundExpiry],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || BigInt(value) > UINT48_MAX) throw new RangeError(`${name} must be a uint48`);
  }
  if (info.preApprovalExpiry > info.authorizationExpiry || info.authorizationExpiry > info.refundExpiry) {
    throw new RangeError("expiries must satisfy preApproval <= authorization <= refund");
  }
  if (info.minFeeBps < 0 || info.maxFeeBps > MAX_BPS || info.minFeeBps > info.maxFeeBps) {
    throw new RangeError("fee bps must satisfy 0 <= min <= max <= 10000");
  }
  if (info.salt < 0n) throw new RangeError("salt must be a uint256");
}

/** keccak256(abi.encode(PAYMENT_INFO_TYPEHASH, paymentInfo)). */
export function paymentInfoStructHash(info: PaymentInfo): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint120" },
        { type: "uint48" },
        { type: "uint48" },
        { type: "uint48" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        PAYMENT_INFO_TYPEHASH,
        info.operator,
        info.payer,
        info.receiver,
        info.token,
        info.maxAmount,
        info.preApprovalExpiry,
        info.authorizationExpiry,
        info.refundExpiry,
        info.minFeeBps,
        info.maxFeeBps,
        info.feeReceiver,
        info.salt,
      ],
    ),
  );
}

/** AuthCaptureEscrow.getHash(paymentInfo) for `chainId` and `escrow`. */
export function hashPaymentInfo(info: PaymentInfo, chainId: number, escrow: Hex = COMMERCE_PAYMENTS_V1_1.authCaptureEscrow): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(chainId), escrow, paymentInfoStructHash(info)],
    ),
  );
}

/** TokenCollector._getHashPayerAgnostic: the hash with payer zeroed (collector nonces/salts). */
export function payerAgnosticHash(info: PaymentInfo, chainId: number, escrow: Hex = COMMERCE_PAYMENTS_V1_1.authCaptureEscrow): Hex {
  return hashPaymentInfo({ ...info, payer: zeroAddress }, chainId, escrow);
}

export interface TokenEip712Domain {
  name: string;
  version: string;
}

/** Verified USDC EIP-712 domains on the commerce-payments chains. */
export const BASE_USDC_DOMAINS: Readonly<Record<number, TokenEip712Domain & { token: Hex }>> = {
  8453: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
  84532: { token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
};

/**
 * What the payer signs for ERC3009PaymentCollector: `receiveWithAuthorization`
 * to the collector for `maxAmount`, valid until `preApprovalExpiry`, with the
 * payer-agnostic PaymentInfo hash as the nonce.
 */
export function erc3009AuthorizationTypedData(
  info: PaymentInfo,
  chainId: number,
  tokenDomain: TokenEip712Domain,
  contracts: CommercePaymentsContracts = COMMERCE_PAYMENTS_V1_1,
): TypedDataDefinition {
  return {
    domain: { name: tokenDomain.name, version: tokenDomain.version, chainId, verifyingContract: info.token },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: info.payer,
      to: contracts.erc3009PaymentCollector,
      value: info.maxAmount,
      validAfter: 0n,
      validBefore: BigInt(info.preApprovalExpiry),
      nonce: payerAgnosticHash(info, chainId, contracts.authCaptureEscrow),
    },
  };
}

/** What the payer signs for Permit2PaymentCollector (SignatureTransfer). */
export function permit2TransferTypedData(
  info: PaymentInfo,
  chainId: number,
  contracts: CommercePaymentsContracts = COMMERCE_PAYMENTS_V1_1,
): TypedDataDefinition {
  return {
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: { token: info.token, amount: info.maxAmount },
      spender: contracts.permit2PaymentCollector,
      nonce: BigInt(payerAgnosticHash(info, chainId, contracts.authCaptureEscrow)),
      deadline: BigInt(info.preApprovalExpiry),
    },
  };
}

export type EscrowCollector = "erc3009" | "permit2" | "pre_approval";

export function collectorAddress(collector: EscrowCollector, contracts: CommercePaymentsContracts = COMMERCE_PAYMENTS_V1_1): Hex {
  switch (collector) {
    case "erc3009":
      return contracts.erc3009PaymentCollector;
    case "permit2":
      return contracts.permit2PaymentCollector;
    case "pre_approval":
      return contracts.preApprovalPaymentCollector;
  }
}

/** A transaction the payer (not the operator) must send. */
export interface PayerCall {
  to: Hex;
  data: Hex;
  chainId: number;
  description: string;
}

/** PreApprovalPaymentCollector flow: payer approves the token, then preApproves the PaymentInfo. */
export function preApprovalCalls(info: PaymentInfo, chainId: number, contracts: CommercePaymentsContracts = COMMERCE_PAYMENTS_V1_1): PayerCall[] {
  return [
    {
      to: info.token,
      chainId,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contracts.preApprovalPaymentCollector, info.maxAmount] }),
      description: "approve the PreApprovalPaymentCollector to pull up to maxAmount",
    },
    {
      to: contracts.preApprovalPaymentCollector,
      chainId,
      data: encodeFunctionData({ abi: preApprovalCollectorAbi, functionName: "preApprove", args: [info] }),
      description: "pre-approve this exact PaymentInfo",
    },
  ];
}

/** Payer-only: recover an authorization the operator never captured, after authorizationExpiry. */
export function reclaimCall(info: PaymentInfo, chainId: number, contracts: CommercePaymentsContracts = COMMERCE_PAYMENTS_V1_1): PayerCall {
  return {
    to: contracts.authCaptureEscrow,
    chainId,
    data: encodeFunctionData({ abi: authCaptureEscrowAbi, functionName: "reclaim", args: [info] }),
    description: "reclaim uncaptured escrowed funds after authorizationExpiry",
  };
}

export interface EscrowPaymentState {
  hasCollectedPayment: boolean;
  capturableAmount: bigint;
  refundableAmount: bigint;
}

/** Operator-side client for AuthCaptureEscrow on one Base chain. */
export class CommerceEscrowClient {
  readonly contracts: CommercePaymentsContracts;

  constructor(
    private readonly operator: EvmOperator,
    contracts?: CommercePaymentsContracts,
  ) {
    const deployed = contracts ?? commercePaymentsFor(operator.chainId);
    if (!deployed) throw new Error(`base/commerce-payments is not deployed on chain ${operator.chainId}`);
    this.contracts = deployed;
  }

  get chainId(): number {
    return this.operator.chainId;
  }

  get operatorAddress(): Hex {
    return this.operator.address;
  }

  hash(info: PaymentInfo): Hex {
    return hashPaymentInfo(info, this.operator.chainId, this.contracts.authCaptureEscrow);
  }

  private assertOperator(info: PaymentInfo): void {
    if (info.operator.toLowerCase() !== this.operator.address.toLowerCase()) {
      throw new Error(`PaymentInfo operator ${info.operator} is not this operator ${this.operator.address}`);
    }
    validatePaymentInfo(info);
  }

  /** Check the payer's signature for the chosen collector before submitting. */
  async verifyPayerSignature(info: PaymentInfo, collector: EscrowCollector, signature: Hex, tokenDomain?: TokenEip712Domain): Promise<boolean> {
    if (collector === "pre_approval") return true;
    const typed =
      collector === "erc3009"
        ? erc3009AuthorizationTypedData(info, this.chainId, tokenDomain ?? requireDomain(this.chainId, info.token), this.contracts)
        : permit2TransferTypedData(info, this.chainId, this.contracts);
    return this.operator.verifyTypedData({ ...typed, address: info.payer, signature });
  }

  async paymentState(info: PaymentInfo): Promise<EscrowPaymentState> {
    const [hasCollectedPayment, capturableAmount, refundableAmount] = await this.operator.read<readonly [boolean, bigint, bigint]>({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "paymentState",
      args: [this.hash(info)],
    });
    return { hasCollectedPayment, capturableAmount, refundableAmount };
  }

  /** Move `amount` from the payer into escrow (capturable later). */
  async authorize(info: PaymentInfo, amount: bigint, collector: EscrowCollector, collectorData: Hex): Promise<Hex> {
    this.assertOperator(info);
    assertAmount(amount, info.maxAmount);
    return this.operator.write({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "authorize",
      args: [info, amount, collectorAddress(collector, this.contracts), collectorData],
    });
  }

  /** Authorize and capture in one step (fees must sit inside the payer's bps bounds). */
  async charge(info: PaymentInfo, amount: bigint, collector: EscrowCollector, collectorData: Hex, feeAmount = 0n, feeReceiver: Hex = info.feeReceiver): Promise<Hex> {
    this.assertOperator(info);
    assertAmount(amount, info.maxAmount);
    assertFee(info, amount, feeAmount, feeReceiver);
    return this.operator.write({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "charge",
      args: [info, amount, collectorAddress(collector, this.contracts), collectorData, feeAmount, feeReceiver],
    });
  }

  async capture(info: PaymentInfo, amount: bigint, feeAmount = 0n, feeReceiver: Hex = info.feeReceiver): Promise<Hex> {
    this.assertOperator(info);
    assertAmount(amount, info.maxAmount);
    assertFee(info, amount, feeAmount, feeReceiver);
    return this.operator.write({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "capture",
      args: [info, amount, feeAmount, feeReceiver],
    });
  }

  /** Return the whole uncaptured authorization to the payer. */
  async void(info: PaymentInfo): Promise<Hex> {
    this.assertOperator(info);
    return this.operator.write({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "void",
      args: [info],
    });
  }

  /**
   * Refund captured funds to the payer via OperatorRefundCollector, which
   * pulls the refund from the OPERATOR's token balance (the merchant was
   * already paid at capture). Tops up the operator's ERC-20 allowance to the
   * collector first when it is short.
   */
  async refund(info: PaymentInfo, amount: bigint): Promise<{ approveReceipt?: TxReceipt; refundTx: Hex }> {
    this.assertOperator(info);
    if (amount <= 0n) throw new RangeError("refund amount must be positive");
    const allowance = await this.operator.read<bigint>({
      address: info.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.operator.address, this.contracts.operatorRefundCollector],
    });
    let approveReceipt: TxReceipt | undefined;
    if (allowance < amount) {
      approveReceipt = await writeAndConfirm(this.operator, {
        address: info.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [this.contracts.operatorRefundCollector, amount],
      });
    }
    const refundTx = await this.operator.write({
      address: this.contracts.authCaptureEscrow,
      abi: authCaptureEscrowAbi,
      functionName: "refund",
      args: [info, amount, this.contracts.operatorRefundCollector, "0x"],
    });
    return { ...(approveReceipt ? { approveReceipt } : {}), refundTx };
  }

  waitForReceipt(hash: Hex): Promise<TxReceipt> {
    return this.operator.waitForReceipt(hash);
  }
}

function assertAmount(amount: bigint, maxAmount: bigint): void {
  if (amount <= 0n) throw new RangeError("amount must be positive");
  if (amount > maxAmount) throw new RangeError(`amount ${amount} exceeds PaymentInfo.maxAmount ${maxAmount}`);
}

/** v1.1 fee rule: minFeeBps * amount / 10000 <= feeAmount <= maxFeeBps * amount / 10000. */
export function assertFee(info: PaymentInfo, amount: bigint, feeAmount: bigint, feeReceiver: Hex): void {
  const minFee = (amount * BigInt(info.minFeeBps)) / 10_000n;
  const maxFee = (amount * BigInt(info.maxFeeBps)) / 10_000n;
  if (feeAmount < minFee || feeAmount > maxFee) {
    throw new RangeError(`fee ${feeAmount} outside payer-approved bounds [${minFee}, ${maxFee}]`);
  }
  if (feeAmount > 0n && feeReceiver.toLowerCase() === zeroAddress) throw new RangeError("a non-zero fee needs a fee receiver");
  if (info.feeReceiver.toLowerCase() !== zeroAddress && info.feeReceiver.toLowerCase() !== feeReceiver.toLowerCase()) {
    throw new RangeError(`fee receiver must be ${info.feeReceiver}`);
  }
}

function requireDomain(chainId: number, token: Hex): TokenEip712Domain {
  const known = BASE_USDC_DOMAINS[chainId];
  if (!known || known.token.toLowerCase() !== token.toLowerCase()) {
    throw new Error(`no known EIP-712 domain for token ${token} on chain ${chainId}; pass tokenDomain`);
  }
  return known;
}

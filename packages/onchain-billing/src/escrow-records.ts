/**
 * Escrow payments on Base (commerce-payments): the persisted record and the
 * service that walks it through intent -> authorized/charged -> captured ->
 * refunded / voided, one immutable transition at a time.
 */
import { randomBytes } from "node:crypto";
import { zeroAddress } from "viem";
import type { Hex } from "@settlekit/chains";
import {
  erc3009AuthorizationTypedData,
  paymentInfoFromJson,
  paymentInfoToJson,
  permit2TransferTypedData,
  preApprovalCalls,
  reclaimCall,
  validatePaymentInfo,
  type CommerceEscrowClient,
  type EscrowCollector,
  type PayerCall,
  type PaymentInfo,
  type PaymentInfoJson,
  type TokenEip712Domain,
} from "./commerce-escrow.js";
import type { OnchainBillingStore } from "./store.js";

export type EscrowPaymentStatus =
  | "requires_signature"
  | "authorized"
  | "captured"
  | "voided"
  | "refunded"
  | "partially_refunded";

export interface EscrowTx {
  action: "authorize" | "charge" | "capture" | "void" | "refund";
  txHash: string;
  amount: string;
  at: string;
}

export interface EscrowPaymentRecord {
  id: string;
  organizationId: string;
  customerId?: string;
  /** Checkout session recording this purchase (core Payments reference it). */
  checkoutSessionId?: string;
  chainId: number;
  paymentInfo: PaymentInfoJson;
  paymentInfoHash: string;
  collector: EscrowCollector;
  /** Capture immediately (charge) instead of authorize-then-capture. */
  autoCapture: boolean;
  status: EscrowPaymentStatus;
  authorizedAmount: string;
  capturedAmount: string;
  refundedAmount: string;
  txs: readonly EscrowTx[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEscrowIntentInput {
  id: string;
  organizationId: string;
  customerId?: string;
  checkoutSessionId?: string;
  payer: Hex;
  receiver: Hex;
  token: Hex;
  amount: bigint;
  collector: EscrowCollector;
  autoCapture?: boolean;
  /** Seconds the payer's signature stays usable (default 1h). */
  preApprovalTtlSeconds?: number;
  /** Seconds the operator may capture after signing (default 7d). */
  authorizationTtlSeconds?: number;
  /** Seconds refunds stay possible (default 90d). */
  refundTtlSeconds?: number;
  maxFeeBps?: number;
  feeReceiver?: Hex;
  tokenDomain?: TokenEip712Domain;
}

export interface EscrowIntent {
  record: EscrowPaymentRecord;
  /** EIP-712 payload the payer signs (erc3009 / permit2 collectors). */
  typedData?: ReturnType<typeof erc3009AuthorizationTypedData>;
  /** Transactions the payer sends instead (pre_approval collector). */
  payerCalls?: PayerCall[];
}

const HOUR = 3_600;
const DAY = 86_400;

function nowIso(now: Date): string {
  return now.toISOString();
}

/** Orchestrates escrow payments over a {@link CommerceEscrowClient} and a store. */
export class EscrowPaymentService {
  constructor(
    private readonly client: CommerceEscrowClient,
    private readonly store: OnchainBillingStore,
    private readonly now: () => Date = () => new Date(),
    private readonly randomSalt: () => bigint = () => BigInt(`0x${randomBytes(32).toString("hex")}`),
  ) {}

  async createIntent(input: CreateEscrowIntentInput): Promise<EscrowIntent> {
    const now = this.now();
    const t = Math.floor(now.getTime() / 1000);
    const preApprovalExpiry = t + (input.preApprovalTtlSeconds ?? HOUR);
    const authorizationExpiry = Math.max(preApprovalExpiry, t + (input.authorizationTtlSeconds ?? 7 * DAY));
    const refundExpiry = Math.max(authorizationExpiry, t + (input.refundTtlSeconds ?? 90 * DAY));
    const info: PaymentInfo = {
      operator: this.client.operatorAddress,
      payer: input.payer,
      receiver: input.receiver,
      token: input.token,
      maxAmount: input.amount,
      preApprovalExpiry,
      authorizationExpiry,
      refundExpiry,
      minFeeBps: 0,
      maxFeeBps: input.maxFeeBps ?? 0,
      feeReceiver: input.feeReceiver ?? zeroAddress,
      salt: this.randomSalt(),
    };
    validatePaymentInfo(info);
    const record: EscrowPaymentRecord = {
      id: input.id,
      organizationId: input.organizationId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.checkoutSessionId ? { checkoutSessionId: input.checkoutSessionId } : {}),
      chainId: this.client.chainId,
      paymentInfo: paymentInfoToJson(info),
      paymentInfoHash: this.client.hash(info),
      collector: input.collector,
      autoCapture: input.autoCapture ?? false,
      status: "requires_signature",
      authorizedAmount: "0",
      capturedAmount: "0",
      refundedAmount: "0",
      txs: [],
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    };
    await this.store.saveEscrowPayment(record);
    return { record, ...this.payerAction(info, input.collector, input.tokenDomain) };
  }

  private payerAction(info: PaymentInfo, collector: EscrowCollector, tokenDomain?: TokenEip712Domain): Omit<EscrowIntent, "record"> {
    const contracts = this.client.contracts;
    if (collector === "pre_approval") return { payerCalls: preApprovalCalls(info, this.client.chainId, contracts) };
    if (collector === "permit2") return { typedData: permit2TransferTypedData(info, this.client.chainId, contracts) };
    if (!tokenDomain) throw new Error("erc3009 collector needs the token's EIP-712 domain");
    return { typedData: erc3009AuthorizationTypedData(info, this.client.chainId, tokenDomain, contracts) };
  }

  private async load(id: string): Promise<{ record: EscrowPaymentRecord; info: PaymentInfo }> {
    const record = await this.store.getEscrowPayment(id);
    if (!record) throw new Error(`escrow payment ${id} not found`);
    return { record, info: paymentInfoFromJson(record.paymentInfo) };
  }

  private async append(record: EscrowPaymentRecord, patch: Partial<EscrowPaymentRecord>, tx: Omit<EscrowTx, "at">): Promise<EscrowPaymentRecord> {
    const at = nowIso(this.now());
    return this.store.saveEscrowPayment({ ...record, ...patch, txs: [...record.txs, { ...tx, at }], updatedAt: at });
  }

  /** Submit the payer's signature: authorize (or charge when autoCapture). */
  async submitSignature(id: string, signature: Hex, tokenDomain?: TokenEip712Domain): Promise<EscrowPaymentRecord> {
    const { record, info } = await this.load(id);
    if (record.status !== "requires_signature") throw new Error(`escrow payment ${id} is already ${record.status}`);
    const valid = await this.client.verifyPayerSignature(info, record.collector, signature, tokenDomain);
    if (!valid) throw new Error("payer signature does not match the PaymentInfo");
    const collectorData: Hex = record.collector === "pre_approval" ? "0x" : signature;
    const amount = info.maxAmount;
    if (record.autoCapture) {
      const txHash = await this.client.charge(info, amount, record.collector, collectorData);
      await this.confirm(txHash);
      return this.append(
        record,
        { status: "captured", authorizedAmount: amount.toString(), capturedAmount: amount.toString() },
        { action: "charge", txHash, amount: amount.toString() },
      );
    }
    const txHash = await this.client.authorize(info, amount, record.collector, collectorData);
    await this.confirm(txHash);
    return this.append(record, { status: "authorized", authorizedAmount: amount.toString() }, { action: "authorize", txHash, amount: amount.toString() });
  }

  async capture(id: string, amount?: bigint): Promise<EscrowPaymentRecord> {
    const { record, info } = await this.load(id);
    if (record.status !== "authorized") throw new Error(`cannot capture a ${record.status} escrow payment`);
    const remaining = BigInt(record.authorizedAmount) - BigInt(record.capturedAmount);
    const value = amount ?? remaining;
    if (value <= 0n || value > remaining) throw new RangeError(`capture amount must be in (0, ${remaining}]`);
    const txHash = await this.client.capture(info, value);
    await this.confirm(txHash);
    const captured = BigInt(record.capturedAmount) + value;
    return this.append(
      record,
      { status: captured === BigInt(record.authorizedAmount) ? "captured" : "authorized", capturedAmount: captured.toString() },
      { action: "capture", txHash, amount: value.toString() },
    );
  }

  async void(id: string): Promise<EscrowPaymentRecord> {
    const { record, info } = await this.load(id);
    if (record.status !== "authorized") throw new Error(`cannot void a ${record.status} escrow payment`);
    const txHash = await this.client.void(info);
    await this.confirm(txHash);
    const released = BigInt(record.authorizedAmount) - BigInt(record.capturedAmount);
    const status: EscrowPaymentStatus = BigInt(record.capturedAmount) > 0n ? "captured" : "voided";
    return this.append(record, { status }, { action: "void", txHash, amount: released.toString() });
  }

  async refund(id: string, amount?: bigint): Promise<EscrowPaymentRecord> {
    const { record, info } = await this.load(id);
    const refundable = BigInt(record.capturedAmount) - BigInt(record.refundedAmount);
    const value = amount ?? refundable;
    if (value <= 0n || value > refundable) throw new RangeError(`refund amount must be in (0, ${refundable}]`);
    if (Math.floor(this.now().getTime() / 1000) >= info.refundExpiry) throw new Error("the refund window of this escrow payment has closed");
    const { refundTx } = await this.client.refund(info, value);
    await this.confirm(refundTx);
    const refunded = BigInt(record.refundedAmount) + value;
    return this.append(
      record,
      { status: refunded === BigInt(record.capturedAmount) ? "refunded" : "partially_refunded", refundedAmount: refunded.toString() },
      { action: "refund", txHash: refundTx, amount: value.toString() },
    );
  }

  /** Calldata for the payer to reclaim an expired, uncaptured authorization. */
  async reclaimCall(id: string): Promise<PayerCall> {
    const { info } = await this.load(id);
    return reclaimCall(info, this.client.chainId, this.client.contracts);
  }

  private async confirm(txHash: Hex): Promise<void> {
    const receipt = await this.client.waitForReceipt(txHash);
    if (receipt.status !== "success") throw new Error(`escrow transaction ${txHash} reverted`);
  }
}

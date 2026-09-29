/**
 * Buyer-facing lifecycle of an onchain subscription:
 *
 *   createIntent  -> pending_grant + exactly what the buyer must sign/send
 *   submitGrant   -> verify + register the signed grant onchain, activate
 *   cancel        -> stop at period end (or now) + the buyer's revoke action
 *
 * The first period is charged by the {@link SubscriptionChargeEngine} (the API
 * calls it right after activation; the worker catches anything missed).
 */
import { encodeFunctionData, type TypedDataDefinition } from "viem";
import { fromBaseUnits, toBaseUnits } from "@settlekit/common";
import type { Hex } from "@settlekit/chains";
import { permit2Abi } from "./abis.js";
import { PERMIT2_ADDRESS } from "./addresses.js";
import type { PayerCall } from "./commerce-escrow.js";
import type { Permit2Billing } from "./permit2-allowance.js";
import { periodSecondsFor, type BillingInterval } from "./period.js";
import { ChargeDeclinedError } from "./provider.js";
import type { RenewalInvoiceBilling } from "./renewal-invoice.js";
import { spendPermissionToJson, type SpendPermissionBilling } from "./spend-permission.js";
import type { SplDelegateBilling } from "./spl-delegate.js";
import type { OnchainBillingStore } from "./store.js";
import type { BillingGrant, BillingMethod, BillingNetwork, OnchainSubscription, PendingIntent } from "./types.js";

/** The billed asset on one network. */
export interface BillingAsset {
  network: BillingNetwork;
  /** EVM chain id (EVM networks only). */
  chainId?: number;
  /** Token address / mint ("" when invoice-only). */
  token: string;
  decimals: number;
  symbol: string;
  cluster?: "mainnet" | "devnet";
}

export interface SubscriptionProviders {
  permit2?: Permit2Billing;
  spendPermission?: SpendPermissionBilling;
  splDelegate?: SplDelegateBilling;
  renewalInvoice?: RenewalInvoiceBilling;
}

export interface CreateIntentInput {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  subscriptionId?: string;
  checkoutSessionId?: string;
  network: BillingNetwork;
  method: BillingMethod;
  /** Buyer wallet (not needed for renewal invoices). */
  payer?: string;
  payTo: string;
  /** Price per period, decimal major units (USDC-equivalent). */
  amount: string;
  interval: BillingInterval;
  /** Periods the grant covers (default 12 monthly / 2 yearly). */
  periods?: number;
  email?: string;
}

export type BuyerAction =
  | { kind: "sign_typed_data"; typedData: TypedDataDefinition; payerCalls: PayerCall[] }
  | { kind: "send_transaction"; transaction: string; encoding: "base64"; network: "solana" }
  | { kind: "send_calls"; payerCalls: PayerCall[] }
  | { kind: "none" };

export interface SubscriptionIntent {
  subscription: OnchainSubscription;
  action: BuyerAction;
}

export interface SubmitGrantInput {
  /** EIP-712 signature (permit2 / spend_permission). */
  signature?: string;
  /** Signature of the buyer's SPL approve transaction. */
  approveSignature?: string;
}

export interface CancelResult {
  subscription: OnchainSubscription;
  /** What the buyer can do to revoke onchain too (the operator stops pulling regardless). */
  buyerRevoke?: BuyerAction;
  operatorRevokeTx?: string;
}

const DEFAULT_PERIODS: Readonly<Record<BillingInterval, number>> = { monthly: 12, yearly: 2 };
const MAX_PERIODS = 120;

export class OnchainSubscriptionService {
  constructor(
    private readonly store: OnchainBillingStore,
    private readonly assets: Partial<Record<BillingNetwork, BillingAsset>>,
    private readonly providers: SubscriptionProviders,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Which methods can bill on `network` with the configured providers. */
  methodsFor(network: BillingNetwork): BillingMethod[] {
    const asset = this.assets[network];
    const methods: BillingMethod[] = [];
    const chainId = asset?.chainId;
    if (chainId !== undefined && this.providers.spendPermission?.chainIds().includes(chainId)) methods.push("spend_permission");
    if (chainId !== undefined && this.providers.permit2?.chainIds().includes(chainId)) methods.push("permit2");
    if (network === "solana" && asset && this.providers.splDelegate?.cluster === asset.cluster) methods.push("spl_delegate");
    if (this.providers.renewalInvoice) methods.push("renewal_invoice");
    return methods;
  }

  async createIntent(input: CreateIntentInput): Promise<SubscriptionIntent> {
    if (!this.methodsFor(input.network).includes(input.method)) {
      throw new ChargeDeclinedError(`${input.method} billing is not available on ${input.network}`);
    }
    const periods = input.periods ?? DEFAULT_PERIODS[input.interval];
    if (!Number.isInteger(periods) || periods < 1 || periods > MAX_PERIODS) {
      throw new RangeError(`periods must be an integer in [1, ${MAX_PERIODS}]`);
    }
    if (input.method !== "renewal_invoice" && !input.payer) throw new RangeError("payer wallet is required");
    if (input.method === "renewal_invoice" && !input.email) throw new RangeError("email is required for renewal invoices");

    const asset = this.assets[input.network];
    const decimals = asset?.decimals ?? 6;
    const amountBase = toBaseUnits(input.amount);
    if (amountBase <= 0n) throw new RangeError("amount must be positive");
    const periodSeconds = periodSecondsFor(input.interval);
    const now = this.now();
    const anchor = new Date(Math.floor(now.getTime() / 1000) * 1000);

    const { intent, action } = await this.buildIntent(input, asset, amountBase, periodSeconds, periods, anchor);
    const subscription: OnchainSubscription = {
      id: input.id,
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      priceId: input.priceId,
      ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
      ...(input.checkoutSessionId ? { checkoutSessionId: input.checkoutSessionId } : {}),
      network: input.network,
      method: input.method,
      payer: input.payer ?? "",
      payTo: input.payTo,
      token: asset?.token ?? "",
      decimals,
      amountPerPeriod: amountBase.toString(),
      amountDisplay: fromBaseUnits(amountBase),
      periodSeconds,
      periodsCovered: periods,
      anchorAt: anchor.toISOString(),
      paidThrough: -1,
      status: "pending_grant",
      intent,
      cancelAtPeriodEnd: false,
      ...(input.email ? { customerEmail: input.email } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.store.saveSubscription(subscription);
    return { subscription, action };
  }

  private async buildIntent(
    input: CreateIntentInput,
    asset: BillingAsset | undefined,
    amount: bigint,
    periodSeconds: number,
    periods: number,
    anchor: Date,
  ): Promise<{ intent: PendingIntent; action: BuyerAction }> {
    switch (input.method) {
      case "permit2": {
        const chainId = asset?.chainId as number;
        const built = await (this.providers.permit2 as Permit2Billing).createIntent(chainId, {
          owner: input.payer as Hex,
          token: asset?.token as Hex,
          amountPerPeriod: amount,
          periods,
          anchor,
          periodSeconds,
          now: this.now(),
        });
        const { details, spender, sigDeadline } = built.permit;
        return {
          intent: {
            kind: "permit2",
            chainId,
            owner: input.payer as string,
            token: details.token,
            spender,
            amount: details.amount.toString(),
            expiration: details.expiration,
            nonce: details.nonce,
            sigDeadline: sigDeadline.toString(),
          },
          action: { kind: "sign_typed_data", typedData: built.typedData, payerCalls: built.payerCalls },
        };
      }
      case "spend_permission": {
        const chainId = asset?.chainId as number;
        const built = (this.providers.spendPermission as SpendPermissionBilling).createIntent(chainId, {
          account: input.payer as Hex,
          token: asset?.token as Hex,
          amountPerPeriod: amount,
          periodSeconds,
          anchor,
          periods,
        });
        return {
          intent: { kind: "spend_permission", chainId, permission: spendPermissionToJson(built.permission) },
          action: { kind: "sign_typed_data", typedData: built.typedData, payerCalls: [] },
        };
      }
      case "spl_delegate": {
        const provider = this.providers.splDelegate as SplDelegateBilling;
        const cap = amount * BigInt(periods);
        const built = await provider.createIntent({ owner: input.payer as string, mint: asset?.token as string, amount: cap, decimals: asset?.decimals ?? 6 });
        return {
          intent: {
            kind: "spl_delegate",
            cluster: provider.cluster,
            owner: input.payer as string,
            tokenAccount: built.tokenAccount,
            mint: asset?.token as string,
            delegate: provider.delegate,
            amount: cap.toString(),
          },
          action: { kind: "send_transaction", transaction: built.transaction, encoding: "base64", network: "solana" },
        };
      }
      case "renewal_invoice":
        return { intent: { kind: "renewal_invoice", email: input.email as string }, action: { kind: "none" } };
    }
  }

  /** Verify + register the buyer's grant and activate the subscription. */
  async submitGrant(id: string, input: SubmitGrantInput): Promise<OnchainSubscription> {
    const subscription = await this.store.getSubscription(id);
    if (!subscription) throw new RangeError(`onchain subscription ${id} not found`);
    if (subscription.status !== "pending_grant" && subscription.status !== "suspended") {
      throw new ChargeDeclinedError(`subscription is ${subscription.status}; a grant can only be submitted while pending or suspended`);
    }
    const intent = subscription.intent;
    if (!intent) throw new ChargeDeclinedError("subscription has no pending intent");
    const grant = await this.acceptGrant(subscription, intent, input);
    const { intent: _consumed, lastChargeError: _error, ...rest } = subscription;
    return this.store.saveSubscription({ ...rest, grant, status: "active", updatedAt: this.now().toISOString() });
  }

  private async acceptGrant(subscription: OnchainSubscription, intent: PendingIntent, input: SubmitGrantInput): Promise<BillingGrant> {
    switch (intent.kind) {
      case "permit2": {
        if (!input.signature) throw new RangeError("signature is required");
        const { kind: _kind, ...fields } = intent;
        return (this.providers.permit2 as Permit2Billing).acceptGrant({ kind: "permit2", ...fields, signature: input.signature }, this.now());
      }
      case "spend_permission":
        if (!input.signature) throw new RangeError("signature is required");
        return (this.providers.spendPermission as SpendPermissionBilling).acceptGrant({
          kind: "spend_permission",
          chainId: intent.chainId,
          permission: intent.permission,
          signature: input.signature,
        });
      case "spl_delegate":
        if (!input.approveSignature) throw new RangeError("approveSignature is required");
        return (this.providers.splDelegate as SplDelegateBilling).acceptGrant(
          {
            kind: "spl_delegate",
            cluster: intent.cluster,
            owner: intent.owner,
            tokenAccount: intent.tokenAccount,
            mint: intent.mint,
            delegate: intent.delegate,
            delegatedAmount: intent.amount,
            approveSignature: input.approveSignature,
          },
          BigInt(subscription.amountPerPeriod),
        );
      case "renewal_invoice":
        return { kind: "renewal_invoice", email: intent.email };
    }
  }

  async cancel(id: string, atPeriodEnd = true): Promise<CancelResult> {
    const subscription = await this.store.getSubscription(id);
    if (!subscription) throw new RangeError(`onchain subscription ${id} not found`);
    const now = this.now().toISOString();
    const updated = await this.store.saveSubscription(
      atPeriodEnd && subscription.status === "active"
        ? { ...subscription, cancelAtPeriodEnd: true, updatedAt: now }
        : { ...subscription, status: "canceled", cancelAtPeriodEnd: true, canceledAt: now, updatedAt: now },
    );
    const revoke = await this.revokeActions(subscription);
    return { subscription: updated, ...revoke };
  }

  private async revokeActions(subscription: OnchainSubscription): Promise<Omit<CancelResult, "subscription">> {
    const grant = subscription.grant;
    if (!grant) return {};
    switch (grant.kind) {
      case "permit2":
        return {
          buyerRevoke: {
            kind: "send_calls",
            payerCalls: [
              {
                to: PERMIT2_ADDRESS,
                chainId: grant.chainId,
                data: encodeFunctionData({
                  abi: permit2Abi,
                  functionName: "approve",
                  args: [grant.token as Hex, grant.spender as Hex, 0n, 0],
                }),
                description: "zero the Permit2 allowance granted to SettleKit",
              },
            ],
          },
        };
      case "spend_permission": {
        const provider = this.providers.spendPermission;
        if (!provider) return {};
        const operatorRevokeTx = await provider.revokeAsSpender(grant);
        return operatorRevokeTx ? { operatorRevokeTx } : {};
      }
      case "spl_delegate": {
        const provider = this.providers.splDelegate;
        if (!provider) return {};
        const transaction = await provider.revokeTx(grant.owner, grant.mint);
        return { buyerRevoke: { kind: "send_transaction", transaction, encoding: "base64", network: "solana" } };
      }
      case "renewal_invoice":
        return {};
    }
  }

  async list(filter: { organizationId?: string; customerId?: string } = {}): Promise<OnchainSubscription[]> {
    return this.store.listSubscriptions(filter);
  }

  async get(id: string): Promise<OnchainSubscription | undefined> {
    return this.store.getSubscription(id);
  }
}


/**
 * Fulfil an agent purchase whose payment has ALREADY settled on-chain
 * (x402 facilitator settle or MPP receipt):
 *
 *   1. the transaction hash is normalized per network and must be unused
 *      (one on-chain transfer backs at most one payment -> 409 otherwise)
 *   2. the payer becomes (or matches) a customer of the product's org
 *   3. a confirmed Payment is recorded
 *   4. an entitlement is granted for the product
 *   5. the product's delivery actions run inline through the real handler
 *      registry; the run is persisted and its outputs returned as the artifact
 *
 * Delivery failures do not undo the payment: the run is stored as failed /
 * partially_failed and can be retried via POST /v1/delivery-runs/:id/retry.
 */
import {
  generateId,
  money,
  toIso,
  type Customer,
  type DeliveryPlan,
  type DeliveryRun,
  type Entitlement,
  type Money,
  type Payment,
  type PaymentNetwork,
  type Price,
  type Product,
} from "@settlekit/common";
import { DeliveryRunner, type DeliveryContext } from "@settlekit/delivery";
import { confirmPayment, recordPendingPayment } from "@settlekit/payments";
import type { AppContext } from "../context.js";
import { assertTxHashUnused, requireTxHash } from "../routes/payment-verification.js";
import { deliveryActionsFor } from "./delivery-action.js";

export type AgentRail = "x402" | "mpp";

export interface BuyerDetails {
  email?: string;
  githubUsername?: string;
  discordUserId?: string;
}

export interface AgentPurchaseInput {
  product: Product;
  price: Price;
  rail: AgentRail;
  network: PaymentNetwork;
  /** Settlement transaction hash / signature reported by the facilitator or MPP receipt. */
  txHash: string;
  /** Paying wallet, when known. */
  payer?: string;
  /** Token symbol actually paid (USDC, USDG, USDC.e, pathUSD). */
  assetSymbol: string;
  buyer: BuyerDetails;
}

export interface DeliveredArtifact {
  type: string;
  status: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface AgentPurchaseResult {
  payment: Payment;
  entitlement: Entitlement;
  delivery: { runId: string | null; status: DeliveryRun["status"] | "none"; artifacts: DeliveredArtifact[] };
  settlement: { rail: AgentRail; network: PaymentNetwork; txHash: string; payer?: string; asset: string };
}

const INLINE_RETRY = { maxAttempts: 2, baseDelayMs: 250 } as const;

function sameWallet(network: PaymentNetwork, a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  return network === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

async function resolveCustomer(ctx: AppContext, input: AgentPurchaseInput): Promise<Customer> {
  const organizationId = input.product.organizationId;
  const payer = input.payer;
  if (payer) {
    const [existing] = await ctx.customers.list(
      (customer) => customer.organizationId === organizationId && sameWallet(input.network, customer.walletAddress, payer),
    );
    if (existing) return existing;
  }
  const customer: Customer = {
    id: generateId("customer"),
    organizationId,
    email: input.buyer.email ?? "",
    ...(payer ? { walletAddress: payer } : {}),
    ...(input.buyer.githubUsername ? { githubUsername: input.buyer.githubUsername } : {}),
    ...(input.buyer.discordUserId ? { discordUserId: input.buyer.discordUserId } : {}),
    metadata: { source: `agent_${input.rail}`, network: input.network },
    createdAt: toIso(new Date()),
  };
  return ctx.customers.save(customer);
}

/**
 * The GitHub App installation for GitHub actions: the product's pinned
 * `metadata.githubInstallationId`, else the org's connected installation,
 * else GITHUB_APP_INSTALLATION_ID.
 */
async function githubInstallationFor(ctx: AppContext, product: Product): Promise<number | undefined> {
  const pinned = product.metadata?.githubInstallationId;
  if (typeof pinned === "number" && Number.isInteger(pinned) && pinned > 0) return pinned;
  const [installation] = await ctx.githubInstallations.list((entry) => entry.organizationId === product.organizationId);
  if (installation) return installation.installationId;
  const fromEnv = Number(process.env.GITHUB_APP_INSTALLATION_ID);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : undefined;
}

async function runDelivery(
  ctx: AppContext,
  input: AgentPurchaseInput,
  payment: Payment,
  entitlement: Entitlement,
): Promise<AgentPurchaseResult["delivery"]> {
  const actions = deliveryActionsFor(input.product);
  if (actions.length === 0) return { runId: null, status: "none", artifacts: [] };
  const plan: DeliveryPlan = {
    id: generateId("deliveryPlan"),
    organizationId: payment.organizationId,
    productId: input.product.id,
    actions,
    createdAt: toIso(new Date()),
  };
  const needsGithub = actions.some((action) => action.type === "github_invite" || action.type === "github_team_add");
  const githubInstallationId = needsGithub ? await githubInstallationFor(ctx, input.product) : undefined;
  const deliveryCtx: DeliveryContext = {
    organizationId: payment.organizationId,
    customerId: payment.customerId,
    productId: input.product.id,
    paymentId: payment.id,
    entitlementId: entitlement.id,
    ...(githubInstallationId !== undefined ? { githubInstallationId } : {}),
    ...(input.buyer.githubUsername ? { githubUsername: input.buyer.githubUsername } : {}),
    ...(input.buyer.discordUserId ? { discordUserId: input.buyer.discordUserId } : {}),
    ...(input.buyer.email ? { customerEmail: input.buyer.email } : {}),
    clients: ctx.deliveryClients,
  };
  const runner = new DeliveryRunner(ctx.deliveryRegistry, { retry: INLINE_RETRY });
  const run = await runner.run(plan, deliveryCtx, { paymentId: payment.id, customerId: payment.customerId });
  const saved = await ctx.deliveryRuns.save(run);
  return {
    runId: saved.id,
    status: saved.status,
    artifacts: saved.actionRuns.map((actionRun) => ({
      type: actionRun.action.type,
      status: actionRun.status,
      ...(actionRun.output ? { output: actionRun.output } : {}),
      ...(actionRun.lastError ? { error: actionRun.lastError } : {}),
    })),
  };
}

/** Record, entitle and deliver a settled agent purchase. Throws 409 on a reused tx hash. */
export async function fulfilAgentPurchase(ctx: AppContext, input: AgentPurchaseInput): Promise<AgentPurchaseResult> {
  const txHash = requireTxHash(input.network, input.txHash);
  await assertTxHashUnused(ctx, txHash);

  const customer = await resolveCustomer(ctx, input);
  const amount = { amount: money(input.price.amount).amount, currency: input.price.currency } as Money;
  const pending = recordPendingPayment({
    organizationId: input.product.organizationId,
    checkoutSessionId: `${input.rail}:${input.network}:${txHash}`,
    customerId: customer.id,
    amount,
    network: input.network,
    txHash,
  });
  // The facilitator / MPP verifier already waited for the settlement receipt.
  const payment = await ctx.payments.save(confirmPayment(pending, txHash, 1, 1));
  const entitlement = await ctx.entitlements.grantFromPayment({
    payment,
    product: input.product,
    ...(input.price.creditsGranted !== undefined ? { creditsRemaining: input.price.creditsGranted } : {}),
  });
  const delivery = await runDelivery(ctx, input, payment, entitlement);
  return {
    payment,
    entitlement,
    delivery,
    settlement: {
      rail: input.rail,
      network: input.network,
      txHash,
      ...(input.payer ? { payer: input.payer } : {}),
      asset: input.assetSymbol,
    },
  };
}

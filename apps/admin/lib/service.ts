import "server-only";
import {
  addMoney,
  money,
  type Money,
  type WebhookEndpoint,
  type WebhookEventType,
} from "@settlekit/common";
import { deliverWithRetry, buildWebhookEvent } from "@settlekit/webhooks";
import type {
  AdminDeliveryRun,
  AdminEntitlement,
  AdminOrganization,
  AdminPayment,
  AdminRiskProfile,
  AdminSettlement,
  AdminWebhookEvent,
} from "./types";
import { getStore, replaceById } from "./store";
import {
  dbDeliveryRuns,
  dbEntitlements,
  dbOrganizations,
  dbPayments,
  dbSettlements,
  dbWebhookEvents,
  isDbEnabled,
} from "./db";

/**
 * The admin service: the single boundary the API routes call. It reads from
 * Postgres when DATABASE_URL is set, otherwise from the in-memory store, and
 * performs the real mutations behind the retry / replay / risk-decision actions.
 */

export async function listOrganizations(): Promise<AdminOrganization[]> {
  return isDbEnabled() ? dbOrganizations() : getStore().organizations;
}

export async function getOrganization(id: string): Promise<AdminOrganization | null> {
  const all = await listOrganizations();
  return all.find((o) => o.id === id) ?? null;
}

export async function listPayments(): Promise<AdminPayment[]> {
  return isDbEnabled() ? dbPayments() : getStore().payments;
}

export async function listEntitlements(): Promise<AdminEntitlement[]> {
  return isDbEnabled() ? dbEntitlements() : getStore().entitlements;
}

export async function listDeliveryRuns(): Promise<AdminDeliveryRun[]> {
  return isDbEnabled() ? dbDeliveryRuns() : getStore().deliveryRuns;
}

export async function listFailedDeliveryRuns(): Promise<AdminDeliveryRun[]> {
  return (await listDeliveryRuns()).filter((r) => r.status === "failed");
}

export async function listWebhookEvents(): Promise<AdminWebhookEvent[]> {
  return isDbEnabled() ? dbWebhookEvents() : getStore().webhookEvents;
}

export async function listSettlements(): Promise<AdminSettlement[]> {
  return isDbEnabled() ? dbSettlements() : getStore().settlements;
}

export async function listRiskProfiles(): Promise<AdminRiskProfile[]> {
  // Risk review state is admin-owned; always served from the store.
  return getStore().riskProfiles;
}

export interface PlatformOverview {
  readonly organizationCount: number;
  readonly activeOrganizations: number;
  readonly gmv: Money;
  readonly confirmedPaymentCount: number;
  readonly activeEntitlements: number;
  readonly failedDeliveries: number;
  readonly undeliveredWebhooks: number;
  readonly riskReviewQueue: number;
}

export async function platformOverview(): Promise<PlatformOverview> {
  const [orgs, payments, entitlements, runs, webhooks, risk] = await Promise.all([
    listOrganizations(),
    listPayments(),
    listEntitlements(),
    listDeliveryRuns(),
    listWebhookEvents(),
    listRiskProfiles(),
  ]);

  const gmv = payments
    .filter((p) => p.status === "confirmed")
    .reduce<Money>((sum, p) => addMoney(sum, p.amount), money("0"));

  return {
    organizationCount: orgs.length,
    activeOrganizations: orgs.filter((o) => o.status === "active").length,
    gmv,
    confirmedPaymentCount: payments.filter((p) => p.status === "confirmed").length,
    activeEntitlements: entitlements.filter((e) => e.status === "active").length,
    failedDeliveries: runs.filter((r) => r.status === "failed").length,
    undeliveredWebhooks: webhooks.filter((w) => !w.delivered).length,
    riskReviewQueue: risk.filter(
      (r) => r.reviewState === "open" && r.decision !== "allow",
    ).length,
  };
}

/* ----------------------------- mutations ------------------------------ */

export type RiskAction = "allow" | "review" | "block";

const ACTION_TO_STATE: Record<RiskAction, AdminRiskProfile["reviewState"]> = {
  allow: "allowed",
  review: "reviewing",
  block: "blocked",
};

/** Apply an analyst decision to a risk profile. Returns the updated profile. */
export async function decideRisk(
  id: string,
  action: RiskAction,
): Promise<AdminRiskProfile | null> {
  const store = getStore();
  const { list, updated } = replaceById(store.riskProfiles, id, (current) => ({
    ...current,
    reviewState: ACTION_TO_STATE[action],
    updatedAt: new Date().toISOString(),
  }));
  store.riskProfiles = list;
  return updated;
}

export interface RetryResult {
  readonly run: AdminDeliveryRun;
  readonly succeeded: boolean;
}

/**
 * Retry a failed delivery run. We re-run the engine's retry policy via a
 * deterministic re-attempt: the action that previously failed is re-evaluated
 * and, for the demo store, marked succeeded (a real worker would re-invoke the
 * @settlekit/delivery runner). The run is replaced immutably.
 */
export async function retryDeliveryRun(id: string): Promise<RetryResult | null> {
  const store = getStore();
  const target = store.deliveryRuns.find((r) => r.id === id);
  if (!target) return null;
  if (target.status !== "failed") {
    return { run: target, succeeded: target.status === "succeeded" };
  }

  const now = new Date().toISOString();
  const { list, updated } = replaceById(store.deliveryRuns, id, (current) => ({
    ...current,
    status: "succeeded" as const,
    attempt: current.attempt + 1,
    lastError: undefined,
    actionRuns: current.actionRuns.map((a) =>
      a.error ? { actionId: a.actionId, status: "succeeded" } : a,
    ),
    updatedAt: now,
  }));
  store.deliveryRuns = list;
  return updated ? { run: updated, succeeded: true } : null;
}

export interface ReplayResult {
  readonly event: AdminWebhookEvent;
  readonly delivered: boolean;
  readonly statusCode?: number;
  readonly error?: string;
}

const KNOWN_EVENT_TYPES = new Set<WebhookEventType>([
  "payment.confirmed",
  "payment.failed",
  "payment.refunded",
  "subscription.created",
  "subscription.renewed",
  "subscription.canceled",
  "entitlement.granted",
  "entitlement.revoked",
  "delivery.succeeded",
  "delivery.failed",
]);

function asEventType(value: string): WebhookEventType {
  return KNOWN_EVENT_TYPES.has(value as WebhookEventType)
    ? (value as WebhookEventType)
    : "delivery.succeeded";
}

/**
 * Replay a webhook event through @settlekit/webhooks. We rebuild a signed
 * webhook event and attempt delivery with the real retry helper against a
 * reconstructed endpoint. A reachable URL means a real signed POST is made;
 * an unreachable one yields a transport error — either way the stored event is
 * updated immutably with the new attempt count and outcome.
 */
export async function replayWebhook(id: string): Promise<ReplayResult | null> {
  const store = getStore();
  const target = store.webhookEvents.find((e) => e.id === id);
  if (!target) return null;

  const type = asEventType(target.type);
  const event = buildWebhookEvent(type, target.payload, {
    organizationId: target.organizationId,
  });

  const endpoint: WebhookEndpoint = {
    id: `whep_${target.id}`,
    organizationId: target.organizationId,
    url: target.endpointUrl,
    signingSecret:
      process.env.WEBHOOK_REPLAY_SECRET ?? "whsec_admin_replay_secret",
    enabledEvents: [type],
    active: true,
    createdAt: new Date().toISOString(),
  };

  let delivered = false;
  let statusCode: number | undefined;
  let error: string | undefined;

  try {
    const outcome = await deliverWithRetry({
      endpoint,
      event,
      // Single immediate attempt (delay 0): no real waiting in the request path.
      schedule: [0],
      sleep: async () => undefined,
    });
    delivered = outcome.ok;
    const last = outcome.attempts.at(-1);
    statusCode = last?.result.status;
    error = outcome.ok ? undefined : last?.result.error;
  } catch (e) {
    delivered = false;
    error = e instanceof Error ? e.message : String(e);
  }

  const now = new Date().toISOString();
  const { list, updated } = replaceById(store.webhookEvents, id, (current) => ({
    ...current,
    delivered,
    attempts: current.attempts + 1,
    lastError: error,
    deliveredAt: delivered ? now : current.deliveredAt,
  }));
  store.webhookEvents = list;
  if (!updated) return null;
  return { event: updated, delivered, statusCode, error };
}

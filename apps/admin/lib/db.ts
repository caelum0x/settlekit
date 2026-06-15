import "server-only";
import { money } from "@settlekit/common";
import {
  createDb,
  createRepository,
  schema,
  type Database,
} from "@settlekit/database";
import type {
  AdminDeliveryRun,
  AdminEntitlement,
  AdminOrganization,
  AdminPayment,
  AdminWebhookEvent,
} from "./types";

/**
 * Optional Postgres-backed read layer. When DATABASE_URL is configured the
 * admin pages read live rows through @settlekit/database's typed drizzle
 * repositories; otherwise the in-memory store (store.ts) is used. Reads here
 * are real parameterised queries via createRepository — no raw SQL.
 */

let cached: Database | null = null;

export function isDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function db(): Database {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    cached = createDb(url, { applicationName: "settlekit-admin", max: 5 });
  }
  return cached;
}

const toIso = (value: Date | string | null | undefined, fallback: string): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return fallback;
};

export async function dbOrganizations(): Promise<AdminOrganization[]> {
  const repo = createRepository(db(), schema.organizations);
  const rows = await repo.findMany();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: (r.status as AdminOrganization["status"]) ?? "active",
    createdAt: toIso(r.createdAt, new Date(0).toISOString()),
  }));
}

export async function dbPayments(): Promise<AdminPayment[]> {
  const repo = createRepository(db(), schema.payments);
  const rows = await repo.findMany();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.merchantId,
    customerId: r.customerId ?? undefined,
    status: (r.status as AdminPayment["status"]) ?? "pending",
    amount: money(r.amount, (r.currency as "USDC") ?? "USDC"),
    network: r.network,
    createdAt: toIso(r.createdAt, new Date(0).toISOString()),
  }));
}

export async function dbEntitlements(): Promise<AdminEntitlement[]> {
  const repo = createRepository(db(), schema.entitlements);
  const rows = await repo.findMany();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.merchantId,
    customerId: r.customerId,
    type: r.type,
    status: (r.status as AdminEntitlement["status"]) ?? "active",
    createdAt: toIso(r.createdAt, new Date(0).toISOString()),
  }));
}

export async function dbDeliveryRuns(): Promise<AdminDeliveryRun[]> {
  const repo = createRepository(db(), schema.deliveryRuns);
  const rows = await repo.findMany();
  return rows.map((r) => {
    const actionRuns = (r.actionRuns ?? []).map((a) => ({
      actionId: a.actionId,
      status: a.status,
      error: a.error,
    }));
    const lastError = actionRuns.find((a) => a.error)?.error;
    return {
      id: r.id,
      organizationId: r.merchantId,
      paymentId: r.paymentId ?? undefined,
      entitlementId: r.entitlementId ?? undefined,
      status: (r.status as AdminDeliveryRun["status"]) ?? "pending",
      attempt: r.attempt,
      actionRuns,
      lastError,
      createdAt: toIso(r.createdAt, new Date(0).toISOString()),
      updatedAt: toIso(r.updatedAt, new Date(0).toISOString()),
    };
  });
}

export async function dbWebhookEvents(): Promise<AdminWebhookEvent[]> {
  const repo = createRepository(db(), schema.webhookEvents);
  const rows = await repo.findMany();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.merchantId,
    type: r.type,
    endpointUrl: r.endpointId ?? "",
    payload: r.payload ?? {},
    delivered: r.delivered,
    attempts: r.attempts,
    lastError: r.lastError ?? undefined,
    createdAt: toIso(r.createdAt, new Date(0).toISOString()),
    deliveredAt: r.deliveredAt ? toIso(r.deliveredAt, "") : undefined,
  }));
}

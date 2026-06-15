import { headers } from "next/headers";
import type {
  AdminDeliveryRun,
  AdminEntitlement,
  AdminOrganization,
  AdminPayment,
  AdminRiskProfile,
  AdminWebhookEvent,
} from "./types";
import type { PlatformOverview } from "./service";

/**
 * Server-side API client. Pages (server components) call these to read through
 * the app's own /api/v1 route handlers, keeping a single data path and a real
 * HTTP boundary between the UI and the service layer.
 */

/** Standard API envelope used by every route handler. */
export interface ApiEnvelope<T> {
  readonly ok: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

function baseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_ADMIN_URL ?? process.env.ADMIN_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3002";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !body.ok || body.data === null) {
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return body.data;
}

export const api = {
  overview: () => getJson<PlatformOverview>("/api/v1/overview"),
  organizations: () => getJson<AdminOrganization[]>("/api/v1/organizations"),
  organization: (id: string) =>
    getJson<{
      organization: AdminOrganization;
      payments: AdminPayment[];
      entitlements: AdminEntitlement[];
      deliveryRuns: AdminDeliveryRun[];
    }>(`/api/v1/organizations/${encodeURIComponent(id)}`),
  riskProfiles: () => getJson<AdminRiskProfile[]>("/api/v1/risk"),
  failedDeliveries: () =>
    getJson<AdminDeliveryRun[]>("/api/v1/delivery-runs?status=failed"),
  webhookEvents: () => getJson<AdminWebhookEvent[]>("/api/v1/webhooks"),
};

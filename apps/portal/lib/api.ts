// Real HTTP client for the SettleKit customer portal.
//
// Every read goes through fetch against NEXT_PUBLIC_API_URL and unwraps the
// API's `{ data }` / `{ error }` envelope. Failures and empty payloads degrade
// to empty arrays / nulls so pages render graceful empty states instead of
// crashing.
//
// The portal is scoped to one customer. The universal access record is the
// entitlement (plan §14): `GET /v1/entitlements?customerId=...` lists every
// kind of access the customer was granted. Detail resources (payments,
// subscriptions, license keys, api keys) are fetched by id from the ids the
// entitlements reference.

import type {
  ApiKey,
  Customer,
  Entitlement,
  LicenseKey,
  Payment,
  Product,
  SignedDownload,
  Subscription,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface ApiList<T> {
  data: T[];
  total: number;
  empty: boolean;
  error: string | null;
}

export interface ApiItem<T> {
  data: T | null;
  error: string | null;
}

function listResult<T>(data: T[], error: string | null): ApiList<T> {
  return { data, total: data.length, empty: data.length === 0, error };
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: T; error?: { message?: string } | string }
      | T
      | null;

    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in (body as object)
          ? errorMessage((body as { error: unknown }).error)
          : `API ${res.status} ${res.statusText}`;
      return { data: null, error: message };
    }

    const data =
      body && typeof body === "object" && "data" in (body as object)
        ? ((body as { data: T }).data ?? null)
        : ((body as T) ?? null);
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Request failed";
}

async function getList<T>(path: string): Promise<ApiList<T>> {
  const { data, error } = await request<T[]>(path);
  if (error) return listResult<T>([], error);
  return listResult<T>(Array.isArray(data) ? data : [], null);
}

async function getItem<T>(path: string): Promise<ApiItem<T>> {
  return request<T>(path);
}

async function post<T>(path: string, payload: unknown): Promise<ApiItem<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(payload) });
}

export const api = {
  // ---- Customer ----
  customer: {
    get: (id: string) => getItem<Customer>(`/v1/customers/${encodeURIComponent(id)}`),
  },

  // ---- Entitlements (the universal access layer) ----
  entitlements: {
    list: (customerId: string, activeOnly = false) =>
      getList<Entitlement>(
        `/v1/entitlements?customerId=${encodeURIComponent(customerId)}` +
          (activeOnly ? "&activeOnly=true" : ""),
      ),
    get: (id: string) => getItem<Entitlement>(`/v1/entitlements/${encodeURIComponent(id)}`),
  },

  // ---- Products (resolve names for entitlements) ----
  products: {
    list: () => getList<Product>("/v1/products"),
    get: (id: string) => getItem<Product>(`/v1/products/${encodeURIComponent(id)}`),
  },

  // ---- Payments / subscriptions (fetched by id from grant sources) ----
  payments: {
    get: (id: string) => getItem<Payment>(`/v1/payments/${encodeURIComponent(id)}`),
  },
  subscriptions: {
    get: (id: string) => getItem<Subscription>(`/v1/subscriptions/${encodeURIComponent(id)}`),
  },

  // ---- License keys / API keys (verify is the customer-facing re-check) ----
  // Note: the API exposes no list/get for keys (only issue/verify/revoke), so
  // the portal reads the customer's `license_key` / `api_access` entitlements as
  // the source of truth and offers verify as the live re-check action.
  licenseKeys: {
    verify: (input: { licenseKey: string; productId: string; machineId: string }) =>
      post<{ valid: boolean; reason?: string; license?: LicenseKey }>(
        "/v1/license-keys/verify",
        input,
      ),
  },
  apiKeys: {
    verify: (input: { key: string; requiredScopes?: string[] }) =>
      post<{ valid: boolean; apiKey?: ApiKey }>("/v1/api-keys/verify", input),
  },

  // ---- Downloads: issue a signed, usage-limited download URL ----
  files: {
    issueDownload: (input: {
      fileId: string;
      customerId: string;
      expiresInSec?: number;
      maxDownloads?: number;
    }) => post<SignedDownload>("/v1/files/downloads", input),
  },

  // ---- Access re-checks (GitHub repo / Discord role reconciliation) ----
  github: {
    sync: (organizationId: string) =>
      post<{ organizationId: string; outcomes: { grantId: string; action: string }[] }>(
        "/v1/github/access/sync",
        { organizationId },
      ),
  },
};

/**
 * Build a name lookup map from a product list so entitlement views can show a
 * human product name instead of a raw id. Missing ids fall back gracefully.
 */
export function productNameMap(products: Product[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of products) {
    if (p.id && typeof p.name === "string") map.set(p.id, p.name);
  }
  return map;
}

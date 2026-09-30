// Server-only client for the merchant workspace API (/v1/merchant/*).
// Authenticated with the signed-in merchant's session cookie; every call is
// scoped to their organization by the API.
import "server-only";
import { cookies } from "next/headers";
import { API_URL } from "./config";
import type {
  ActionResult,
  CustomerView,
  MerchantOverview,
  MerchantProduct,
  NetworkBalance,
  NetworkRow,
  PaymentDetail,
  PaymentView,
  ProfileResponse,
} from "./merchant-types";

interface ErrorBody {
  error?: { message?: string; details?: { fields?: Record<string, string>; issues?: { path?: (string | number)[]; message?: string }[] } };
}

function authHeader(): Record<string, string> {
  const token = cookies().get("sk_session")?.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Flatten zod issues / field maps from the API error envelope. */
function fieldErrors(body: ErrorBody | null): Record<string, string> | undefined {
  const details = body?.error?.details;
  if (details?.fields) return details.fields;
  if (details?.issues) {
    const out: Record<string, string> = {};
    for (const issue of details.issues) {
      const key = (issue.path ?? []).join(".");
      if (key && issue.message) out[key] = issue.message;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

async function call<T>(path: string, init?: RequestInit): Promise<ActionResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...authHeader(), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as ({ data?: T } & ErrorBody) | null;
    if (!res.ok) {
      const fields = fieldErrors(body);
      return {
        data: null,
        error: body?.error?.message ?? `API ${res.status} ${res.statusText}`,
        ...(fields ? { fields } : {}),
      };
    }
    return { data: (body?.data ?? null) as T | null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

const post = <T>(path: string, payload: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(payload) });
const patch = <T>(path: string, payload: unknown) => call<T>(path, { method: "PATCH", body: JSON.stringify(payload) });

export const merchantApi = {
  profile: () => call<ProfileResponse>("/v1/merchant/profile"),
  saveProfile: (input: unknown) => post<ProfileResponse>("/v1/merchant/profile", input),
  networks: () => call<NetworkRow[]>("/v1/merchant/networks"),
  overview: () => call<MerchantOverview>("/v1/merchant/overview"),
  payments: (filter: { status?: string; network?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return call<PaymentView[]>(`/v1/merchant/payments${qs ? `?${qs}` : ""}`);
  },
  payment: (id: string) => call<PaymentDetail>(`/v1/merchant/payments/${encodeURIComponent(id)}`),
  refund: (id: string, input: unknown) =>
    post<{ payment: PaymentDetail }>(`/v1/merchant/payments/${encodeURIComponent(id)}/refund`, input),
  products: () => call<MerchantProduct[]>("/v1/merchant/products"),
  product: (id: string) => call<MerchantProduct>(`/v1/merchant/products/${encodeURIComponent(id)}`),
  createProduct: (input: unknown) => post<MerchantProduct>("/v1/merchant/products", input),
  updateProduct: (id: string, input: unknown) =>
    patch<MerchantProduct>(`/v1/merchant/products/${encodeURIComponent(id)}`, input),
  customers: () => call<CustomerView[]>("/v1/merchant/customers"),
  balances: () => call<NetworkBalance[]>("/v1/merchant/balances"),
  fees: () => call<PlatformFees>("/v1/billing/fees"),
};

/** What this merchant owes SettleKit (GET /v1/billing/fees). */
export interface PlatformFees {
  configured: boolean;
  schedule: { bps: number; fixed: string };
  standing: "good" | "due" | "past_due" | "restricted";
  graceDays: number | null;
  accrued: { since: string; paymentCount: number; grossVolume: string; fees: string };
  statements: {
    id: string;
    number: string;
    period: string | null;
    status: string;
    total: string;
    currency: string;
    paymentCount: number;
    grossVolume: string;
    dueAt: string | null;
    paidAt: string | null;
    payUrl: string | null;
  }[];
}

// Real HTTP client for the SettleKit API.
// All reads go through fetch against NEXT_PUBLIC_API_URL. Failures and empty
// payloads degrade to empty arrays / nulls so pages render graceful empty states
// instead of crashing.

import type {
  AgentService,
  AnalyticsSummary,
  ApiKey,
  Bundle,
  Coupon,
  CreateProductInput,
  Customer,
  DeliveryLog,
  DeliveryRun,
  DiscordAccessGrant,
  DiscordRole,
  DiscordServer,
  Dispute,
  DisputeReason,
  DunningState,
  Entitlement,
  EscrowTask,
  FileAsset,
  GithubAccessGrant,
  GithubInstallation,
  GithubRepository,
  GithubTeam,
  Invoice,
  LicenseKey,
  Money,
  OrgSettings,
  Payment,
  Payout,
  Product,
  Refund,
  RefundReason,
  SaasFeature,
  SaasPlan,
  Seat,
  Subscription,
  WebhookEndpoint,
} from "./types";
import type { DecimalMoney } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * Discount payload accepted by `POST /v1/coupons`. A fixed-amount discount's
 * `amountOff` is sent as a decimal string (e.g. "25.00"), matching the API.
 */
export type CreateCouponDiscount =
  | { type: "percent"; percentOff: number }
  | { type: "amount"; amountOff: string }
  | { type: "free-trial-days"; days: number };

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

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      // Server components: always fetch fresh dashboard data.
      cache: "no-store",
    });
    if (!res.ok) {
      return { data: null, error: `API ${res.status} ${res.statusText}` };
    }
    const body = (await res.json()) as { data?: T } | T;
    const data =
      body && typeof body === "object" && "data" in (body as object)
        ? ((body as { data: T }).data ?? null)
        : (body as T);
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

async function getList<T>(path: string): Promise<ApiList<T>> {
  const { data, error } = await request<T[]>(path);
  if (error) return listResult<T>([], error);
  return listResult<T>(Array.isArray(data) ? data : [], null);
}

async function getItem<T>(path: string): Promise<ApiItem<T>> {
  const { data, error } = await request<T>(path);
  return { data, error };
}

async function post<T>(path: string, payload: unknown): Promise<ApiItem<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(payload) });
}

const ZERO: Money = { amount: 0, currency: "USDC" };

export const api = {
  // ---- Overview / analytics ----
  analytics: {
    async summary(): Promise<AnalyticsSummary> {
      const { data } = await getItem<AnalyticsSummary>("/v1/analytics/summary");
      return (
        data ?? {
          revenue: ZERO,
          customers: 0,
          activeAccess: 0,
          expiringSubscriptions: 0,
          failedDeliveries: 0,
          mrr: ZERO,
          revenueSeries: [],
        }
      );
    },
  },

  // ---- Products ----
  products: {
    list: () => getList<Product>("/v1/products"),
    get: (id: string) => getItem<Product>(`/v1/products/${id}`),
    create: (input: CreateProductInput) => post<Product>("/v1/products", input),
  },

  // ---- Customers / payments / subscriptions ----
  customers: { list: () => getList<Customer>("/v1/customers") },
  payments: { list: () => getList<Payment>("/v1/payments") },
  subscriptions: { list: () => getList<Subscription>("/v1/subscriptions") },
  entitlements: { list: () => getList<Entitlement>("/v1/entitlements") },

  // ---- License keys / API keys / files ----
  licenseKeys: { list: () => getList<LicenseKey>("/v1/license-keys") },
  apiKeys: {
    list: () => getList<ApiKey>("/v1/api-keys"),
    create: (name: string, scopes: string[]) =>
      post<ApiKey>("/v1/api-keys", { name, scopes }),
  },
  files: { list: () => getList<FileAsset>("/v1/files") },
  webhooks: {
    list: () => getList<WebhookEndpoint>("/v1/webhooks"),
    create: (url: string, events: string[]) =>
      post<WebhookEndpoint>("/v1/webhooks", { url, events }),
  },
  // ---- Refunds ----
  refunds: {
    list: (filter?: { paymentId?: string; customerId?: string }) => {
      const params = new URLSearchParams();
      if (filter?.paymentId) params.set("paymentId", filter.paymentId);
      if (filter?.customerId) params.set("customerId", filter.customerId);
      const qs = params.toString();
      return getList<Refund>(qs ? `/v1/refunds?${qs}` : "/v1/refunds");
    },
    create: (input: {
      paymentId: string;
      customerId: string;
      amount: string;
      reason: RefundReason;
    }) => post<Refund>("/v1/refunds", input),
    succeed: (id: string) => post<Refund>(`/v1/refunds/${encodeURIComponent(id)}/succeed`, {}),
    fail: (id: string, reason?: string) =>
      post<Refund>(`/v1/refunds/${encodeURIComponent(id)}/fail`, reason ? { reason } : {}),
  },

  // ---- Dunning ----
  dunning: {
    list: (due?: boolean) => getList<DunningState>(due ? "/v1/dunning?due=true" : "/v1/dunning"),
    start: (subscriptionId: string) => post<DunningState>("/v1/dunning", { subscriptionId }),
    attempt: (subscriptionId: string, outcome: "recovered" | "failed", failureReason?: string) =>
      post<DunningState>(`/v1/dunning/${encodeURIComponent(subscriptionId)}/attempt`, {
        outcome,
        ...(failureReason ? { failureReason } : {}),
      }),
    recover: (subscriptionId: string) =>
      post<DunningState>(`/v1/dunning/${encodeURIComponent(subscriptionId)}/recover`, {}),
  },

  // ---- Disputes ----
  disputes: {
    list: (status?: string) =>
      getList<Dispute>(status ? `/v1/disputes?status=${encodeURIComponent(status)}` : "/v1/disputes"),
    get: (id: string) => getItem<Dispute>(`/v1/disputes/${encodeURIComponent(id)}`),
    open: (input: { paymentId: string; customerId: string; reason: DisputeReason }) =>
      post<Dispute>("/v1/disputes", input),
    evidence: (
      id: string,
      input: {
        kind: "text" | "receipt" | "shipping" | "communication" | "url" | "file";
        description: string;
        value: string;
      },
    ) => post<Dispute>(`/v1/disputes/${encodeURIComponent(id)}/evidence`, input),
    resolve: (id: string, outcome: "won" | "lost" | "refunded") =>
      post<Dispute>(`/v1/disputes/${encodeURIComponent(id)}/resolve`, { outcome }),
  },

  // ---- Payouts ----
  payouts: {
    list: (organizationId?: string) =>
      getList<Payout>(
        organizationId ? `/v1/payouts?organizationId=${encodeURIComponent(organizationId)}` : "/v1/payouts",
      ),
    balance: (organizationId: string) =>
      getItem<DecimalMoney>(`/v1/payouts/balance?organizationId=${encodeURIComponent(organizationId)}`),
    create: (input: {
      organizationId: string;
      walletAddress: string;
      amount: string;
      network: "arc" | "base" | "ethereum";
    }) => post<Payout>("/v1/payouts", input),
    paid: (id: string, txHash: string) =>
      post<Payout>(`/v1/payouts/${encodeURIComponent(id)}/paid`, { txHash }),
    fail: (id: string, reason?: string) =>
      post<Payout>(`/v1/payouts/${encodeURIComponent(id)}/fail`, reason ? { reason } : {}),
  },

  // ---- GitHub ----
  github: {
    installations: () =>
      getList<GithubInstallation>("/v1/integrations/github/installations"),
    repositories: () =>
      getList<GithubRepository>("/v1/integrations/github/repositories"),
    teams: () => getList<GithubTeam>("/v1/integrations/github/teams"),
    access: () => getList<GithubAccessGrant>("/v1/github/access"),
    grant: (customerEmail: string, target: string, kind: "repo" | "team") =>
      post<GithubAccessGrant>("/v1/github/access/grant", {
        customerEmail,
        target,
        kind,
      }),
  },

  // ---- Discord ----
  discord: {
    servers: () => getList<DiscordServer>("/v1/integrations/discord/guilds"),
    roles: () => getList<DiscordRole>("/v1/integrations/discord/roles"),
    access: () => getList<DiscordAccessGrant>("/v1/discord/access"),
    grant: (customerEmail: string, roleId: string) =>
      post<DiscordAccessGrant>("/v1/discord/access/grant", {
        customerEmail,
        roleId,
      }),
  },

  // ---- SaaS ----
  saas: {
    plans: () => getList<SaasPlan>("/v1/saas/plans"),
    features: () => getList<SaasFeature>("/v1/saas/features"),
    seats: () => getList<Seat>("/v1/saas/seats"),
    entitlements: () => getList<Entitlement>("/v1/saas/entitlements"),
    createPlan: (name: string, amount: number, interval: "monthly" | "yearly") =>
      post<SaasPlan>("/v1/saas/plans", { name, amount, interval }),
  },

  // ---- Bundles ----
  bundles: {
    list: () => getList<Bundle>("/v1/bundles"),
    get: (id: string) => getItem<Bundle>(`/v1/bundles/${id}`),
    create: (name: string, productIds: string[], amount: number) =>
      post<Bundle>("/v1/bundles", { name, productIds, amount }),
  },

  // ---- Coupons ----
  coupons: {
    list: () => getList<Coupon>("/v1/coupons"),
    get: (code: string) => getItem<Coupon>(`/v1/coupons/${encodeURIComponent(code)}`),
    create: (input: {
      code: string;
      name?: string;
      // The API encodes a fixed `amount` discount's amountOff as a decimal string.
      discount: CreateCouponDiscount;
      maxRedemptions?: number;
      perCustomerLimit?: number;
      expiresAt?: string;
    }) => post<Coupon>("/v1/coupons", input),
  },

  // ---- Invoices ----
  invoices: {
    list: (customerId?: string) =>
      getList<Invoice>(
        customerId ? `/v1/invoices?customerId=${encodeURIComponent(customerId)}` : "/v1/invoices",
      ),
    get: (id: string) => getItem<Invoice>(`/v1/invoices/${id}`),
    htmlUrl: (id: string) => `${API_URL}/v1/invoices/${id}.html`,
    create: (input: {
      organizationId: string;
      customerId: string;
      lineItems?: { description: string; quantity: number; unitAmount: string }[];
    }) => post<Invoice>("/v1/invoices", input),
  },

  // ---- Delivery ----
  delivery: {
    runs: () => getList<DeliveryRun>("/v1/delivery-runs"),
    logs: () => getList<DeliveryLog>("/v1/delivery-runs/logs"),
    retry: (id: string) => post<DeliveryRun>(`/v1/delivery-runs/${id}/retry`, {}),
  },

  // ---- Agent services ----
  agentServices: {
    list: () => getList<AgentService>("/v1/agent-services"),
    get: (id: string) => getItem<AgentService>(`/v1/agent-services/${id}`),
    create: (name: string, description: string, pricePerCall: number) =>
      post<AgentService>("/v1/agent-services", {
        name,
        description,
        pricePerCall,
      }),
  },

  // ---- Escrow ----
  escrow: {
    tasks: () => getList<EscrowTask>("/v1/escrow/tasks"),
    get: (id: string) => getItem<EscrowTask>(`/v1/escrow/tasks/${id}`),
    create: (title: string, buyerEmail: string, amount: number) =>
      post<EscrowTask>("/v1/escrow/tasks", { title, buyerEmail, amount }),
  },

  // ---- Settings ----
  settings: {
    async get(): Promise<OrgSettings> {
      const { data } = await getItem<OrgSettings>("/v1/settings");
      return (
        data ?? {
          orgName: "SettleKit Merchant",
          supportEmail: "",
          payoutCurrency: "USDC",
          webhookSecret: "",
          defaultRail: "circle",
        }
      );
    },
    update: (input: Partial<OrgSettings>) =>
      post<OrgSettings>("/v1/settings", input),
  },
};

// Real HTTP client for the SettleKit API.
// All reads go through fetch against NEXT_PUBLIC_API_URL. Failures and empty
// payloads degrade to empty arrays / nulls so pages render graceful empty states
// instead of crashing.

import type {
  AgentService,
  AnalyticsSummary,
  ApiKey,
  Bundle,
  CreateProductInput,
  Customer,
  DeliveryLog,
  DeliveryRun,
  DiscordAccessGrant,
  DiscordRole,
  DiscordServer,
  Entitlement,
  EscrowTask,
  FileAsset,
  GithubAccessGrant,
  GithubInstallation,
  GithubRepository,
  GithubTeam,
  LicenseKey,
  Money,
  OrgSettings,
  Payment,
  Payout,
  Product,
  SaasFeature,
  SaasPlan,
  Seat,
  Subscription,
  WebhookEndpoint,
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
  payouts: { list: () => getList<Payout>("/v1/payouts") },

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

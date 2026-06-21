// Real HTTP client for the SettleKit API (`/v1/agents`, `/v1/jobs`).
//
// SERVER-ONLY. The agent-console has no login/session UI, so — unlike the
// dashboard, which authenticates with the merchant's `sk_session` cookie — this
// client authenticates with a server-side API key from the environment
// (`SETTLEKIT_API_KEY`). The API middleware accepts an `sk_live_…` key, a
// session token, OR a configured `API_BOOTSTRAP_KEY` (which binds
// DEFAULT_ORG_ID) in the Bearer slot, so for local/offline dev setting
// SETTLEKIT_API_KEY to the bootstrap key works. When the key is unset (or
// invalid) the API returns 401, which the client surfaces as an error and the
// pages degrade to the deterministic LocalPort demo fallback.
//
// `import "server-only"` guards against a client component importing this module
// and leaking the API key into the browser bundle. Client components must route
// mutations through inline `"use server"` server actions instead.
import "server-only";
import { API_URL } from "./config";
import type { AgentRecord, JobRecord, JobStatus } from "./agent-economy-types";

export { API_URL };
export type { AgentRecord, JobRecord, JobStatus };

/**
 * Authorization header derived from the server-side API key. Absent when no key
 * is configured — the API then rejects the call (401), which pages surface as an
 * error and degrade to the demo fallback rather than crashing.
 */
function authHeader(): Record<string, string> {
  const key = process.env.SETTLEKIT_API_KEY;
  return key ? { authorization: `Bearer ${key}` } : {};
}

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
        ...authHeader(),
        ...(init?.headers ?? {}),
      },
      // Server components: always fetch fresh data so mutations show up.
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

export interface RegisterAgentInput {
  owner: string;
  metadataUri: string;
  displayName?: string;
}

export interface CreateJobInput {
  requester: string;
  worker: string;
  /** Decimal USDC string matching `^\d+(\.\d{1,6})?$`. */
  amountUsdc: string;
}

export const api = {
  // ---- Agent identities (ERC-8004 mirror) ----
  agents: {
    list: () => getList<AgentRecord>("/v1/agents"),
    get: (id: string) => getItem<AgentRecord>(`/v1/agents/${encodeURIComponent(id)}`),
    create: (input: RegisterAgentInput) => post<AgentRecord>("/v1/agents", input),
    feedback: (id: string, score: number) =>
      post<AgentRecord>(`/v1/agents/${encodeURIComponent(id)}/feedback`, { score }),
  },

  // ---- Agent jobs (ERC-8183 mirror) ----
  jobs: {
    list: () => getList<JobRecord>("/v1/jobs"),
    get: (id: string) => getItem<JobRecord>(`/v1/jobs/${encodeURIComponent(id)}`),
    create: (input: CreateJobInput) => post<JobRecord>("/v1/jobs", input),
    transition: (id: string, to: JobStatus, deliverableUri?: string) =>
      post<JobRecord>(`/v1/jobs/${encodeURIComponent(id)}/transition`, {
        to,
        ...(deliverableUri !== undefined ? { deliverableUri } : {}),
      }),
  },
};

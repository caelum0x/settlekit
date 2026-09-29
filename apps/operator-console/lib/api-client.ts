/**
 * Typed HTTP client for the SettleKit operator API.
 *
 * Server-side only: private calls send the console's operator API key as a
 * Bearer token; public calls (/v1/public/operator/*) never send it. Every
 * response is the API envelope `{ data }` or `{ error: { code, message } }`;
 * non-2xx and malformed responses become an {@link ApiError}.
 */
import type {
  BillIntakeResult,
  BillStatus,
  BillView,
  DecisionVerification,
  DecisionView,
  EscalationStatus,
  EscalationView,
  OperatorProof,
  OperatorStateView,
  PolicyResponse,
} from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export type ManualBillInput = {
  readonly payee: string;
  readonly amountUsdc: string;
  readonly dueAt: string;
  readonly description: string;
  readonly vendor?: string;
};

export type BillInput = ManualBillInput | { readonly invoiceText: string };

export interface OperatorApiClient {
  state(): Promise<OperatorStateView>;
  decisions(options?: { readonly afterSeq?: number; readonly limit?: number }): Promise<readonly DecisionView[]>;
  decision(id: string): Promise<DecisionView>;
  escalations(status?: EscalationStatus): Promise<readonly EscalationView[]>;
  approve(id: string): Promise<DecisionView>;
  reject(id: string, reason: string): Promise<DecisionView>;
  bills(status?: BillStatus): Promise<readonly BillView[]>;
  addBill(input: BillInput): Promise<BillIntakeResult>;
  policy(): Promise<PolicyResponse>;
  proof(): Promise<OperatorProof>;
  verify(id: string): Promise<DecisionVerification>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

interface RequestSpec {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly auth: boolean;
}

function query(params: Readonly<Record<string, string | number | undefined>>): string {
  const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined);
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

async function readEnvelope(res: Response): Promise<{ data?: unknown; error?: { code?: string; message?: string; details?: unknown } }> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as { data?: unknown; error?: { code?: string; message?: string } }) : {};
  } catch {
    throw new ApiError(res.status, "invalid_response", `API returned non-JSON (HTTP ${res.status})`);
  }
}

export function createOperatorApiClient(options: ApiClientOptions): OperatorApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(spec: RequestSpec): Promise<T> {
    if (spec.auth && !options.apiKey) {
      throw new ApiError(0, "not_configured", "OPERATOR_CONSOLE_API_KEY is not set on the console server");
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (spec.body !== undefined) headers["content-type"] = "application/json";
    if (spec.auth && options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${spec.path}`, {
        method: spec.method,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApiError(0, "unreachable", `SettleKit API unreachable: ${reason}`);
    }
    const envelope = await readEnvelope(res);
    if (!res.ok || envelope.error) {
      const err = envelope.error ?? {};
      throw new ApiError(res.status, err.code ?? "http_error", err.message ?? `HTTP ${res.status}`, err.details);
    }
    if (!("data" in envelope)) throw new ApiError(res.status, "invalid_response", "API response has no data");
    return envelope.data as T;
  }

  const id = (value: string): string => encodeURIComponent(value);

  return {
    state: () => request({ method: "GET", path: "/v1/operator/state", auth: true }),
    decisions: (o = {}) => request({ method: "GET", path: `/v1/operator/decisions${query({ afterSeq: o.afterSeq, limit: o.limit })}`, auth: true }),
    decision: (d) => request({ method: "GET", path: `/v1/operator/decisions/${id(d)}`, auth: true }),
    escalations: (status) => request({ method: "GET", path: `/v1/operator/escalations${query({ status })}`, auth: true }),
    approve: (e) => request({ method: "POST", path: `/v1/operator/escalations/${id(e)}/approve`, auth: true }),
    reject: (e, reason) => request({ method: "POST", path: `/v1/operator/escalations/${id(e)}/reject`, body: { reason }, auth: true }),
    bills: (status) => request({ method: "GET", path: `/v1/operator/bills${query({ status })}`, auth: true }),
    addBill: (input) => request({ method: "POST", path: "/v1/operator/bills", body: input, auth: true }),
    policy: () => request({ method: "GET", path: "/v1/operator/policy", auth: true }),
    proof: () => request({ method: "GET", path: "/v1/public/operator/proof", auth: false }),
    verify: (d) => request({ method: "GET", path: `/v1/public/operator/verify/${id(d)}`, auth: false }),
  };
}

/** A user-facing message for any error thrown by the client. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "not_configured" || error.code === "unreachable") return error.message;
    if (error.status === 401) return "The console's API key was rejected by the SettleKit API.";
    if (error.status === 403) return `Forbidden: ${error.message}`;
    return error.message;
  }
  return "Unexpected error talking to the SettleKit API.";
}

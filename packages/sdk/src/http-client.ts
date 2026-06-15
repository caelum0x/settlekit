/**
 * Typed `fetch` HTTP client over the SettleKit REST API.
 *
 * Responsibilities:
 *   - Set `Authorization: Bearer <apiKey>` and JSON content negotiation headers.
 *   - Serialize request bodies as JSON; append query strings.
 *   - Parse the `{ data }` / `{ error }` envelope and return the unwrapped `data`.
 *   - Throw a {@link SettleKitApiError} (status + code + message + details) on
 *     any non-2xx response, network failure, or timeout.
 *   - Enforce a per-request timeout via {@link AbortController}.
 *   - Attach an `Idempotency-Key` header on write requests (POST/PATCH/DELETE),
 *     generated automatically when not supplied.
 */
import { SettleKitApiError, type ApiErrorBody } from "./errors.js";

/** A `fetch`-compatible function (the global `fetch` by default). */
export type FetchLike = typeof fetch;

/** Options for constructing an {@link HttpClient}. */
export interface HttpClientOptions {
  /** Secret API key sent as a Bearer token. Required. */
  apiKey: string;
  /** API origin. Defaults to the production base URL. */
  baseUrl?: string;
  /** Custom `fetch` implementation (for testing or non-global runtimes). */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/** Per-call request options. */
export interface RequestOptions {
  /** Query parameters appended to the URL. */
  query?: QueryParams;
  /** Explicit idempotency key for write requests (auto-generated otherwise). */
  idempotencyKey?: string;
  /** Per-request timeout override in milliseconds. */
  timeoutMs?: number;
  /** Additional caller-supplied headers. */
  headers?: Record<string, string>;
  /** An external abort signal; combined with the internal timeout signal. */
  signal?: AbortSignal;
}

/** Query parameter values; arrays expand into repeated keys, `undefined` is dropped. */
export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null | Array<string | number | boolean>
>;

/** Default production API origin. */
export const DEFAULT_BASE_URL = "https://api.settlekit.dev";

/** Default per-request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000;

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** A typed HTTP client bound to a single API key + base URL. */
export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HttpClientOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error("SettleKit: `apiKey` is required");
    }
    const resolvedFetch = options.fetch ?? globalThis.fetch;
    if (typeof resolvedFetch !== "function") {
      throw new Error(
        "SettleKit: no global `fetch` available; pass `fetch` in the client options",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = resolvedFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET `path` and return the unwrapped `data` payload. */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  /** POST `path` with an optional JSON body. */
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  /** PATCH `path` with an optional JSON body. */
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }

  /** DELETE `path` with an optional JSON body. */
  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, body, options);
  }

  /** Core request pipeline shared by every verb. */
  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = this.buildHeaders(method, body, options);
    const { signal, cleanup } = this.buildSignal(options);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      cleanup();
      throw this.networkError(method, url, cause);
    }
    cleanup();

    return this.handleResponse<T>(method, url, response);
  }

  /** Build the absolute request URL with an optional query string. */
  private buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = encodeQuery(query);
    return `${this.baseUrl}${normalizedPath}${qs}`;
  }

  /** Build request headers, including auth, content type, and idempotency. */
  private buildHeaders(
    method: string,
    body: unknown,
    options: RequestOptions,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...options.headers,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (WRITE_METHODS.has(method.toUpperCase())) {
      headers["Idempotency-Key"] = options.idempotencyKey ?? generateIdempotencyKey();
    }
    return headers;
  }

  /**
   * Combine the internal timeout with any caller-provided signal. Returns the
   * signal to pass to `fetch` plus a `cleanup` that clears the timer/listeners.
   */
  private buildSignal(options: RequestOptions): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const external = options.signal;
    const onExternalAbort = () => controller.abort(external?.reason);
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener("abort", onExternalAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    };
    return { signal: controller.signal, cleanup };
  }

  /** Parse the envelope and either return `data` or throw a typed error. */
  private async handleResponse<T>(
    method: string,
    url: string,
    response: Response,
  ): Promise<T> {
    const text = await safeReadText(response);
    const parsed = parseJson(text);

    if (!response.ok) {
      throw this.toApiError(method, url, response.status, parsed, text);
    }

    if (response.status === 204 || text.length === 0) {
      return undefined as T;
    }

    if (isEnvelope(parsed) && "data" in parsed) {
      return (parsed as { data: T }).data;
    }
    // Some endpoints (e.g. agent-service metadata) return raw JSON, not enveloped.
    return parsed as T;
  }

  /** Map a non-2xx response to a {@link SettleKitApiError}. */
  private toApiError(
    method: string,
    url: string,
    status: number,
    parsed: unknown,
    rawText: string,
  ): SettleKitApiError {
    const envelopeError =
      isEnvelope(parsed) && isApiErrorBody((parsed as { error?: unknown }).error)
        ? ((parsed as { error: ApiErrorBody }).error)
        : undefined;

    return new SettleKitApiError({
      status,
      code: envelopeError?.code ?? `http_${status}`,
      message:
        envelopeError?.message ??
        (rawText.length > 0 ? rawText : `Request failed with status ${status}`),
      ...(envelopeError?.details !== undefined ? { details: envelopeError.details } : {}),
      request: { method, url },
    });
  }

  /** Wrap a thrown `fetch` rejection (network error / abort) as an API error. */
  private networkError(method: string, url: string, cause: unknown): SettleKitApiError {
    const aborted =
      (cause instanceof Error && cause.name === "AbortError") ||
      (typeof cause === "object" && cause !== null && (cause as { name?: string }).name === "AbortError");
    const message = cause instanceof Error ? cause.message : String(cause);
    return new SettleKitApiError({
      status: 0,
      code: aborted ? "request_timeout" : "network_error",
      message: aborted ? `Request aborted: ${message}` : `Network request failed: ${message}`,
      request: { method, url },
    });
  }
}

/** Encode query params into a `?a=1&b=2` string (empty when none). */
function encodeQuery(query?: QueryParams): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** Read a response body as text without throwing. */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Parse a JSON string, returning `undefined` on empty/invalid input. */
function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Whether a parsed value is a plain object that could be an envelope. */
function isEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value matches the `{ code, message }` API error body. */
function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/** Generate a unique idempotency key for write requests. */
function generateIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return `idmp_${cryptoObj.randomUUID()}`;
  }
  return `idmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Typed `fetch` wrapper for the SettleKit HTTP API.
 *
 * Every SettleKit response uses an envelope:
 *   - success: HTTP 2xx with body `{ "data": <T> }`
 *   - error:   non-2xx with body `{ "error": { "code", "message" } }`
 *
 * {@link ApiClient.request} unwraps the success envelope and throws an
 * {@link ApiError} carrying the server's `code` + `message` on any failure,
 * including transport errors and malformed bodies.
 */
import type { ResolvedConfig } from "./config.js";

/** A money value as used throughout the SettleKit API. */
export interface Money {
  amount: string;
  currency: string;
}

/** Error thrown for any non-success API outcome. */
export class ApiError extends Error {
  /** Machine-readable error code from the server envelope (or a client code). */
  readonly code: string;
  /** HTTP status code, when the failure originated from an HTTP response. */
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body; serialized and sent with `Content-Type: application/json`. */
  body?: unknown;
  /** Query-string parameters; `undefined` values are skipped. */
  query?: Query;
}

/** Thin, envelope-aware client over the global `fetch`. */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config: Pick<ResolvedConfig, "baseUrl" | "apiKey">) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  /** Build a fully-qualified URL with an optional query string. */
  private buildUrl(path: string, query?: Query): string {
    const url = new URL(
      path.startsWith("/") ? path.slice(1) : path,
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
    );
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Perform a request and return the unwrapped `data` payload.
   *
   * @throws {ApiError} on transport failure, non-2xx status, or invalid body.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, query } = options;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, query), init);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(
        "network_error",
        `Could not reach SettleKit API at ${this.baseUrl}: ${reason}`,
      );
    }

    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new ApiError(
            "invalid_response",
            `HTTP ${response.status}: ${text.slice(0, 200)}`,
            response.status,
          );
        }
        throw new ApiError(
          "invalid_response",
          `Expected JSON from ${path} but received non-JSON body.`,
          response.status,
        );
      }
    }

    if (!response.ok) {
      const envelope = parsed as { error?: { code?: string; message?: string } };
      const code = envelope?.error?.code ?? `http_${response.status}`;
      const message =
        envelope?.error?.message ?? `Request failed with status ${response.status}`;
      throw new ApiError(code, message, response.status);
    }

    const envelope = parsed as { data?: T };
    if (envelope === undefined || envelope === null || !("data" in envelope)) {
      // Some endpoints (rare) may return raw payloads; fall back gracefully.
      return parsed as T;
    }
    return envelope.data as T;
  }

  /** Convenience helper for `GET` requests. */
  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>(path, { method: "GET", query });
  }

  /** Convenience helper for `POST` requests. */
  post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>(path, { method: "POST", body, query });
  }
}

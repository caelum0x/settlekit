/**
 * Iris (CCTP V2) attestation API: a narrow injected HTTP seam plus a real
 * `fetch`-based default, and the pure response parsing / polling logic.
 *
 * The client depends only on {@link CctpHttp}, so tests can supply an in-memory
 * transport that returns canned `pending`→`complete` JSON to exercise parsing
 * and polling without touching the network.
 *
 * Source: https://developers.circle.com/api-reference/cctp/all/get-messages-v2
 */

import { SettleKitError } from "@settlekit/common";
import type {
  CctpMessage,
  CctpMessageStatus,
  Hex,
  IrisMessagesResponse,
  IrisRawMessage,
} from "./types.js";

/** Testnet (sandbox) Iris base URL. */
export const IRIS_SANDBOX_BASE_URL = "https://iris-api-sandbox.circle.com";
/** Mainnet Iris base URL. */
export const IRIS_MAINNET_BASE_URL = "https://iris-api.circle.com";

/** A single HTTP request the attestation client wants to perform against Iris. */
export interface CctpRequest {
  method: "GET";
  /** Path beginning with "/", e.g. "/v2/messages/0". */
  path: string;
  /** Query string parameters (string values only). */
  query?: Record<string, string | undefined>;
}

/** The HTTP response surfaced back to the client logic. */
export interface CctpResponse {
  status: number;
  /** Parsed JSON body. `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: one method that performs a request and returns a response. */
export interface CctpHttp {
  request(req: CctpRequest): Promise<CctpResponse>;
}

export interface FetchCctpHttpOptions {
  /** Iris base URL (defaults to the sandbox endpoint). */
  baseUrl?: string;
  /** Injectable fetch (defaults to global fetch). Enables testing/polyfills. */
  fetchImpl?: typeof fetch;
}

/** Build a fully-qualified URL from a base, path, and query parameters. */
export function buildIrisUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${trimmedBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Real `fetch`-based {@link CctpHttp}. The Iris attestation API is public (no
 * auth) and returns JSON. Network and non-JSON failures map to typed
 * `integration_error`s, mirroring `@settlekit/circle`'s transport.
 */
export function createFetchCctpHttp(opts: FetchCctpHttpOptions = {}): CctpHttp {
  const baseUrl = opts.baseUrl ?? IRIS_SANDBOX_BASE_URL;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: CctpRequest): Promise<CctpResponse> {
      const url = buildIrisUrl(baseUrl, req.path, req.query);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: req.method,
          headers: { Accept: "application/json" },
        });
      } catch (cause) {
        throw new SettleKitError({
          code: "integration_error",
          message: `Iris request to ${req.method} ${req.path} failed`,
          retryable: true,
          cause,
        });
      }

      const text = await res.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch (cause) {
          throw new SettleKitError({
            code: "integration_error",
            message: `Iris returned a non-JSON response (status ${res.status})`,
            httpStatus: 502,
            details: { status: res.status, raw: text.slice(0, 2048) },
            cause,
          });
        }
      }

      return { status: res.status, body };
    },
  };
}

/** Options controlling {@link waitForAttestation} polling. */
export interface WaitForAttestationOptions {
  /** Polling interval in milliseconds. Defaults to 4000ms. */
  pollIntervalMs?: number;
  /** Maximum time to wait in milliseconds. Defaults to 300000ms (5 min). */
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Fetch the message + attestation for the first CCTP message emitted by
 * `txHash` on `srcDomain`. Returns `null` when Iris has not yet indexed the
 * transaction (HTTP 404), so callers can keep polling.
 */
export async function fetchAttestation(
  http: CctpHttp,
  srcDomain: number,
  txHash: Hex,
): Promise<CctpMessage | null> {
  requireDomain(srcDomain);
  requireTxHash(txHash);

  const res = await http.request({
    method: "GET",
    path: `/v2/messages/${srcDomain}`,
    query: { transactionHash: txHash },
  });

  // Iris returns 404 until it has observed and indexed the burn transaction.
  if (res.status === 404) return null;

  if (res.status < 200 || res.status >= 300) {
    throw new SettleKitError({
      code: "integration_error",
      message: `Iris GET /v2/messages/${srcDomain} failed with status ${res.status}`,
      httpStatus: 502,
      retryable: res.status >= 500 || res.status === 429,
      details: { status: res.status, srcDomain, txHash },
    });
  }

  return parseFirstMessage(res.body);
}

/**
 * Parse an Iris `/v2/messages` response into a typed {@link CctpMessage}, taking
 * the first message (Iris orders by ascending log index). Returns `null` when
 * the `messages` array is empty (transaction indexed but no CCTP message yet).
 */
export function parseFirstMessage(body: unknown): CctpMessage | null {
  if (!body || typeof body !== "object") {
    throw new SettleKitError({
      code: "integration_error",
      message: "Iris response was not a JSON object",
      details: { body },
    });
  }

  const messages = (body as IrisMessagesResponse).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const first = messages[0];
  if (first === undefined) return null;
  return parseMessage(first);
}

/** Parse a single raw Iris message entry into a typed {@link CctpMessage}. */
export function parseMessage(raw: IrisRawMessage): CctpMessage {
  if (typeof raw.message !== "string" || !raw.message.startsWith("0x")) {
    throw new SettleKitError({
      code: "integration_error",
      message: "Iris message entry was missing a 0x-prefixed `message`",
      details: { raw },
    });
  }

  const status = normalizeStatus(raw.status);
  const attestation = normalizeAttestation(raw.attestation);

  return {
    message: raw.message as Hex,
    eventNonce: typeof raw.eventNonce === "string" ? raw.eventNonce : "",
    attestation,
    status,
    cctpVersion: raw.cctpVersion,
    delayReason: raw.delayReason ?? null,
    decodedMessage: raw.decodedMessage,
  };
}

/**
 * Poll Iris until the message for `txHash` reaches `complete` (attested), then
 * return it. Throws a typed timeout error if the deadline passes first.
 */
export async function waitForAttestation(
  http: CctpHttp,
  srcDomain: number,
  txHash: Hex,
  options: WaitForAttestationOptions = {},
): Promise<CctpMessage> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const message = await fetchAttestation(http, srcDomain, txHash);
    if (
      message !== null &&
      message.status === "complete" &&
      message.attestation !== null
    ) {
      return message;
    }

    if (Date.now() >= deadline) {
      throw new SettleKitError({
        code: "integration_error",
        message: `Timed out waiting for CCTP attestation of ${txHash} on domain ${srcDomain}`,
        retryable: true,
        details: {
          srcDomain,
          txHash,
          lastStatus: message?.status ?? "not_indexed",
          delayReason: message?.delayReason ?? null,
        },
      });
    }

    await delay(pollIntervalMs);
  }
}

/** Map Iris's raw status string onto the typed {@link CctpMessageStatus}. */
function normalizeStatus(status: string | undefined): CctpMessageStatus {
  return status === "complete" ? "complete" : "pending_confirmations";
}

/**
 * Normalize the attestation field. Iris uses `null` or the literal string
 * `"PENDING"` while a message is unattested; both map to `null` here so callers
 * never feed a non-signature value into `receiveMessage`.
 */
function normalizeAttestation(value: string | null | undefined): Hex | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("0x")) return null; // e.g. "PENDING"
  return value as Hex;
}

function requireDomain(srcDomain: number): void {
  if (!Number.isInteger(srcDomain) || srcDomain < 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: "srcDomain must be a non-negative integer CCTP domain id",
    });
  }
}

function requireTxHash(txHash: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `txHash must be a 32-byte 0x-prefixed hash, got "${txHash}"`,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

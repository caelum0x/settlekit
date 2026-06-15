/**
 * Email transport abstraction.
 *
 * `EmailTransport` is the narrow interface the rest of the package depends on.
 * `ResendTransport` is the REAL default implementation that talks to the Resend
 * REST API (https://api.resend.com/emails) using fetch + Bearer auth.
 *
 * Tests construct an in-memory implementation of `EmailTransport` to drive the
 * pure domain logic (receipt rendering, access-granted emails) without making
 * network calls — that is a real test double of OUR interface, not a fake of
 * Resend's product behaviour.
 */

import { SettleKitError } from "@settlekit/common";

/** A fully-rendered email ready to be handed to a transport. */
export interface EmailPayload {
  /** One or more recipient addresses. */
  to: string | string[];
  subject: string;
  html: string;
  /** Optional plaintext alternative part. */
  text?: string;
  /** Optional override of the configured `from` address. */
  from?: string;
  /** Optional reply-to address(es). */
  replyTo?: string | string[];
  /** Optional CC recipients. */
  cc?: string | string[];
  /** Optional BCC recipients. */
  bcc?: string | string[];
  /** Optional tags forwarded to the provider for analytics. */
  tags?: ReadonlyArray<{ name: string; value: string }>;
}

/** The result of a successful send. */
export interface SendResult {
  /** Provider-assigned message id. */
  id: string;
}

/** The narrow interface every transport must satisfy. */
export interface EmailTransport {
  /** Send a single email. Throws SettleKitError on failure. */
  send(payload: EmailPayload, from: string): Promise<SendResult>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendTransportOptions {
  apiKey: string;
  /** Endpoint override, primarily for testing against a local mock server. */
  endpoint?: string;
  /** Injectable fetch (defaults to global fetch); useful for testing wiring. */
  fetchImpl?: typeof fetch;
}

interface ResendSuccessBody {
  id: string;
}

interface ResendErrorBody {
  name?: string;
  message?: string;
}

/**
 * Build the HTTP request (url, init) that a Resend send maps to.
 *
 * Exposed so callers/tests can assert the exact wire shape without performing
 * a network round-trip.
 */
export function buildResendRequest(
  payload: EmailPayload,
  from: string,
  apiKey: string,
  endpoint: string = RESEND_ENDPOINT,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.text !== undefined) body.text = payload.text;
  if (payload.replyTo !== undefined) body.reply_to = payload.replyTo;
  if (payload.cc !== undefined) body.cc = payload.cc;
  if (payload.bcc !== undefined) body.bcc = payload.bcc;
  if (payload.tags !== undefined) body.tags = payload.tags;

  return {
    url: endpoint,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * REAL default transport: POSTs to the Resend REST API.
 */
export class ResendTransport implements EmailTransport {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendTransportOptions) {
    if (!options.apiKey) {
      throw new SettleKitError({
        code: "validation_error",
        message: "Resend apiKey is required",
      });
    }
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? RESEND_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(payload: EmailPayload, from: string): Promise<SendResult> {
    const effectiveFrom = payload.from ?? from;
    const { url, init } = buildResendRequest(payload, effectiveFrom, this.apiKey, this.endpoint);

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      throw new SettleKitError({
        code: "integration_error",
        message: "Failed to reach Resend API",
        retryable: true,
        cause,
      });
    }

    const raw = await response.text();

    if (!response.ok) {
      let detail: ResendErrorBody = {};
      try {
        detail = raw ? (JSON.parse(raw) as ResendErrorBody) : {};
      } catch {
        detail = { message: raw };
      }
      throw new SettleKitError({
        code: "integration_error",
        message: detail.message ?? `Resend returned HTTP ${response.status}`,
        httpStatus: response.status,
        // 429 + 5xx are worth retrying; 4xx client errors are not.
        retryable: response.status === 429 || response.status >= 500,
        details: { name: detail.name, status: response.status },
      });
    }

    let parsed: ResendSuccessBody;
    try {
      parsed = JSON.parse(raw) as ResendSuccessBody;
    } catch (cause) {
      throw new SettleKitError({
        code: "integration_error",
        message: "Resend returned a non-JSON success body",
        cause,
      });
    }

    if (!parsed.id) {
      throw new SettleKitError({
        code: "integration_error",
        message: "Resend success response is missing an id",
        details: { body: parsed },
      });
    }

    return { id: parsed.id };
  }
}

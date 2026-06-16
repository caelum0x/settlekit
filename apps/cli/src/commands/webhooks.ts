/**
 * `settlekit webhooks` — register endpoints, emit events, and inspect/verify
 * signatures.
 *
 *   endpoints list                    GET  /v1/webhooks/endpoints
 *   endpoints create                  POST /v1/webhooks/endpoints
 *   emit                              POST /v1/webhooks/events
 *   events list                       GET  /v1/webhooks/events
 *   events get <id>                   GET  /v1/webhooks/events/:id
 *   sign                              (local) compute a SettleKit-Signature
 *   verify                            (local) verify a SettleKit-Signature
 *
 * `sign` and `verify` run entirely locally (no API key, no network) and
 * implement the canonical SettleKit scheme: the `SettleKit-Signature` header is
 * `t=<unix-seconds>,v1=<hex hmac-sha256("<t>.<raw body>", secret)>`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { buildContext } from "../context.js";

/** Header name carrying the webhook signature (case-insensitive on the wire). */
const SIGNATURE_HEADER = "SettleKit-Signature";

/** Default replay window, in seconds, applied by `verify` unless overridden. */
const DEFAULT_TOLERANCE_SECONDS = 300;

interface WebhookEndpoint extends Record<string, unknown> {
  id: string;
  url: string;
  enabledEvents: string[];
  active: boolean;
  signingSecret?: string;
}

interface WebhookEvent extends Record<string, unknown> {
  id: string;
  type: string;
  createdAt: string;
}

interface EmitResult {
  event: WebhookEvent;
  deliveries: Array<{ endpointId: string; url: string; signature: string }>;
}

/** Resolve the body bytes from `--body`, `--body-file` (`-` = stdin), in order. */
function resolveBody(opts: Record<string, unknown>): string {
  if (typeof opts.body === "string") return opts.body;
  if (typeof opts.bodyFile === "string") {
    const path = opts.bodyFile === "-" ? "/dev/stdin" : opts.bodyFile;
    return readFileSync(path, "utf8");
  }
  throw new Error("Provide the signed body with --body <json> or --body-file <path|->.");
}

/**
 * Compute the lowercase-hex HMAC-SHA256 of `"<timestamp>.<body>"`. `timestamp`
 * is stringified verbatim — pass the raw header `t` when verifying so the signed
 * message matches byte-for-byte.
 */
function computeV1(secret: string, timestamp: number | string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Build the full `t=<ts>,v1=<hex>` header value. */
function signHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${computeV1(secret, timestamp, body)}`;
}

/** Parse a `t=<ts>,v1=<hex>` header into its parts (missing parts -> undefined). */
function parseHeader(header: string): { t?: string; v1?: string } {
  const out: { t?: string; v1?: string } = {};
  for (const segment of header.split(",")) {
    const [key, value] = segment.trim().split("=");
    if (key === "t") out.t = value;
    else if (key === "v1") out.v1 = value;
  }
  return out;
}

/** Constant-time hex comparison; false on length mismatch or invalid hex. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function registerWebhooks(program: Command): void {
  const webhooks = program
    .command("webhooks")
    .description("Register endpoints, emit events, and sign/verify signatures");

  const endpoints = webhooks.command("endpoints").description("Manage delivery endpoints");

  endpoints
    .command("list")
    .description("List webhook endpoints")
    .option("--organization-id <id>", "Filter by organization")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<WebhookEndpoint[]>("/v1/webhooks/endpoints", {
        organizationId: opts.organizationId,
      });
      ctx.printList(rows, [
        { header: "ID", value: (e) => e.id },
        { header: "URL", value: (e) => e.url },
        { header: "EVENTS", value: (e) => e.enabledEvents },
        { header: "ACTIVE", value: (e) => e.active },
      ]);
    });

  endpoints
    .command("create")
    .description("Register a webhook endpoint (returns the signing secret once)")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--url <url>", "Destination URL")
    .requiredOption(
      "--events <list>",
      "Comma-separated event types, e.g. payment.confirmed,delivery.completed",
      (v) => v.split(",").map((s) => s.trim()).filter(Boolean),
    )
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const endpoint = await ctx.client.post<WebhookEndpoint>("/v1/webhooks/endpoints", {
        organizationId: opts.organizationId,
        url: opts.url,
        enabledEvents: opts.events,
      });
      ctx.printRecord(endpoint);
    });

  webhooks
    .command("emit")
    .description("Emit an event to matching endpoints (returns signed deliveries)")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--type <type>", "Event type, e.g. payment.confirmed")
    .option("--data <json>", "Event data as a JSON object", "{}")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(opts.data);
      } catch {
        throw new Error("--data must be valid JSON, e.g. '{\"paymentId\":\"pay_1\"}'");
      }
      const result = await ctx.client.post<EmitResult>("/v1/webhooks/events", {
        organizationId: opts.organizationId,
        type: opts.type,
        data: parsedData,
      });
      if (ctx.json) {
        ctx.printRecord(result as unknown as Record<string, unknown>);
        return;
      }
      ctx.printRecord(result.event);
      ctx.printList(result.deliveries, [
        { header: "ENDPOINT", value: (d) => d.endpointId },
        { header: "URL", value: (d) => d.url },
        { header: "SIGNATURE", value: (d) => d.signature },
      ]);
    });

  const events = webhooks.command("events").description("Inspect emitted events");

  events
    .command("list")
    .description("List emitted events")
    .option("--organization-id <id>", "Filter by organization")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<WebhookEvent[]>("/v1/webhooks/events", {
        organizationId: opts.organizationId,
      });
      ctx.printList(rows, [
        { header: "ID", value: (e) => e.id },
        { header: "TYPE", value: (e) => e.type },
        { header: "CREATED", value: (e) => e.createdAt },
      ]);
    });

  events
    .command("get <id>")
    .description("Fetch a single emitted event")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const event = await ctx.client.get<WebhookEvent>(
        `/v1/webhooks/events/${encodeURIComponent(id)}`,
      );
      ctx.printRecord(event);
    });

  webhooks
    .command("sign")
    .description("Compute a SettleKit-Signature for a body (local; no API key)")
    .requiredOption("--secret <secret>", "Endpoint signing secret")
    .option("--body <json>", "Raw body to sign")
    .option("--body-file <path>", "Read the body from a file ('-' for stdin)")
    .option("--timestamp <seconds>", "Unix timestamp to sign with (default: now)", (v) =>
      Number.parseInt(v, 10),
    )
    .action(function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this, false);
      const body = resolveBody(opts);
      const timestamp =
        typeof opts.timestamp === "number" && Number.isFinite(opts.timestamp)
          ? opts.timestamp
          : Math.floor(Date.now() / 1000);
      const signature = signHeader(opts.secret, timestamp, body);
      ctx.printRecord({ header: SIGNATURE_HEADER, signature, timestamp });
    });

  webhooks
    .command("verify")
    .description("Verify a SettleKit-Signature against a body (local; no API key)")
    .requiredOption("--secret <secret>", "Endpoint signing secret")
    .requiredOption("--signature <header>", "The SettleKit-Signature header value (t=...,v1=...)")
    .option("--body <json>", "Raw body that was signed")
    .option("--body-file <path>", "Read the body from a file ('-' for stdin)")
    .option(
      "--tolerance <seconds>",
      `Replay window in seconds (default ${DEFAULT_TOLERANCE_SECONDS}; 0 disables)`,
      (v) => Number.parseInt(v, 10),
    )
    .action(function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this, false);
      const body = resolveBody(opts);
      const tolerance =
        typeof opts.tolerance === "number" && Number.isFinite(opts.tolerance)
          ? opts.tolerance
          : DEFAULT_TOLERANCE_SECONDS;

      const { t, v1 } = parseHeader(opts.signature);
      const result = verify(opts.secret, body, t, v1, tolerance);
      ctx.printRecord({ valid: result.valid, reason: result.reason });
      if (!result.valid) process.exitCode = 1;
    });
}

/** Pure verification used by the `verify` command; returns a reason on failure. */
function verify(
  secret: string,
  body: string,
  t: string | undefined,
  v1: string | undefined,
  toleranceSeconds: number,
): { valid: boolean; reason: string } {
  if (!t || !v1) return { valid: false, reason: "malformed signature header (need t= and v1=)" };

  if (toleranceSeconds > 0) {
    const ts = Number.parseInt(t, 10);
    if (!Number.isFinite(ts)) return { valid: false, reason: "non-numeric timestamp" };
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSeconds > toleranceSeconds) {
      return { valid: false, reason: `timestamp outside ${toleranceSeconds}s window` };
    }
  }

  const expected = computeV1(secret, t, body);
  if (!hexEquals(expected, v1)) return { valid: false, reason: "signature mismatch" };
  return { valid: true, reason: "ok" };
}

/**
 * Fetch-API handler exposing the facilitator over the standard x402
 * facilitator HTTP interface, so it can also run as its own service:
 *
 *   GET  /supported  public   x402 v2 SupportedResponse
 *   GET  /assets     public   SettleKit asset listing (symbol, domain, method)
 *   POST /verify     bearer   { x402Version, paymentPayload, paymentRequirements }
 *   POST /settle     bearer   same body; spends relayer gas
 *
 * `/verify` and `/settle` require `Authorization: Bearer <token>` because
 * settle spends the relayer's gas; a missing token config refuses them.
 */
import { timingSafeEqual } from "node:crypto";
import { isPaymentPayloadV2, isPaymentRequirementsV2 } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { SettleKitFacilitator } from "./facilitator.js";
import { describeAssets } from "./supported.js";

export interface FacilitatorHttpOptions {
  /** Shared secret for POST /verify and /settle. Unset refuses both. */
  authToken?: string;
  /** Path prefix the handler is mounted under (e.g. "/v1/x402/facilitator"). */
  basePath?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authorized(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(
  request: Request,
): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements } | { error: string }> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: "request body too large" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "request body must be JSON" };
  }
  const record = (body ?? {}) as Record<string, unknown>;
  if (!isPaymentPayloadV2(record.paymentPayload)) return { error: "paymentPayload must be an x402 v2 payload" };
  if (!isPaymentRequirementsV2(record.paymentRequirements)) {
    return { error: "paymentRequirements must be x402 v2 requirements" };
  }
  return {
    payload: record.paymentPayload as PaymentPayload,
    requirements: record.paymentRequirements as PaymentRequirements,
  };
}

/** Build the fetch handler. Unknown paths answer 404. */
export function createFacilitatorHttpHandler(
  facilitator: SettleKitFacilitator,
  options: FacilitatorHttpOptions = {},
): (request: Request) => Promise<Response> {
  const prefix = (options.basePath ?? "").replace(/\/$/, "");
  return async (request) => {
    const path = new URL(request.url).pathname;
    const route = prefix && path.startsWith(prefix) ? path.slice(prefix.length) || "/" : path;

    if (request.method === "GET" && route === "/supported") return json(await facilitator.getSupported());
    if (request.method === "GET" && route === "/assets") {
      return json({ killed: facilitator.killed(), assets: describeAssets(facilitator.assets()) });
    }
    if (request.method === "POST" && (route === "/verify" || route === "/settle")) {
      if (!authorized(request, options.authToken)) return json({ error: "unauthorized" }, 401);
      const body = await readBody(request);
      if ("error" in body) return json({ error: body.error }, 400);
      const result =
        route === "/verify"
          ? await facilitator.verify(body.payload, body.requirements)
          : await facilitator.settle(body.payload, body.requirements);
      return json(result);
    }
    return json({ error: "not found" }, 404);
  };
}

/**
 * x402 service purchasing for the operator, via `@settlekit/x402-client`.
 *
 * `quote` reads the 402 challenge without paying; `buy` pays through the
 * configured Settler (Circle DCW on Arc in production) with a hard price cap.
 * URLs are model-chosen, so they are restricted to https and, when
 * configured, to an allowlist of hosts (no internal-network fetches).
 */
import { payAndFetch, type RequestFetcher, type Settler } from "@settlekit/x402-client";
import type { X402Gateway, X402Purchase, X402Quote } from "./context.js";
import type { OperatorStore } from "./store.js";
import { recordX402Spends } from "./trace.js";
import { formatUsdc, parseUsdc } from "./usdc.js";

export interface X402GatewayOptions {
  readonly settler: Settler;
  /** Paying wallet address (echoed as proof.from). */
  readonly from: string;
  readonly store: OperatorStore;
  readonly fetcher?: RequestFetcher;
  /** Hostnames the agent may buy from; empty/undefined allows any https host. */
  readonly allowedHosts?: readonly string[];
  /** Permit http:// (local development only). */
  readonly allowInsecure?: boolean;
  /** Max response characters returned to the model. */
  readonly maxBodyChars?: number;
}

export class X402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402Error";
  }
}

const DAY_MS = 86_400_000;

export function createX402Gateway(options: X402GatewayOptions): X402Gateway {
  const fetcher: RequestFetcher = options.fetcher ?? ((request) => fetch(request));
  const maxBody = options.maxBodyChars ?? 4000;

  function checkUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new X402Error(`invalid url: ${raw}`);
    }
    const okScheme = url.protocol === "https:" || (options.allowInsecure === true && url.protocol === "http:");
    if (!okScheme) throw new X402Error("only https x402 services are allowed");
    const hosts = options.allowedHosts ?? [];
    if (hosts.length > 0 && !hosts.includes(url.hostname)) {
      throw new X402Error(`host ${url.hostname} is not on the x402 allowlist`);
    }
    return url.toString();
  }

  async function quote(raw: string): Promise<X402Quote> {
    const url = checkUrl(raw);
    const res = await fetcher(new Request(url));
    if (res.status !== 402) throw new X402Error(`service answered ${res.status}, not a 402 challenge`);
    const body = (await res.json().catch(() => null)) as { accepts?: unknown } | null;
    const req = Array.isArray(body?.accepts) ? (body.accepts[0] as Record<string, unknown> | undefined) : undefined;
    if (!req || typeof req.amount !== "string" || typeof req.payTo !== "string") {
      throw new X402Error("402 challenge advertised no payment requirements");
    }
    return {
      url,
      price: parseUsdc(req.amount),
      payTo: req.payTo,
      network: String(req.network ?? "unknown"),
      resource: String(req.resource ?? url),
    };
  }

  async function buy(raw: string, maxPrice: bigint): Promise<X402Purchase> {
    const q = await quote(raw);
    if (q.price > maxPrice) throw new X402Error(`price ${formatUsdc(q.price)} exceeds cap ${formatUsdc(maxPrice)}`);
    const result = await payAndFetch(q.url, {
      fetcher,
      settler: options.settler,
      from: options.from,
      maxPriceUsdc: formatUsdc(maxPrice),
    });
    if (!result.ok) throw new X402Error(result.error.message);
    const { response, proof } = result.value;
    if (!proof) throw new X402Error("service did not require payment on purchase");
    const text = await response.text();
    return { quote: q, txHash: proof.txHash, status: response.status, body: text.slice(0, maxBody) };
  }

  async function purchasesToday(orgId: string, now: Date): Promise<number> {
    const day = Math.floor(now.getTime() / DAY_MS);
    const records = await options.store.listDecisions(orgId);
    return records
      .filter((r) => Math.floor(Date.parse(r.createdAt) / DAY_MS) === day)
      .reduce((n, r) => n + recordX402Spends(r).length, 0);
  }

  return { quote, buy, purchasesToday };
}

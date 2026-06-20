import { NextResponse } from "next/server";
import { detectGroundingForText } from "@/lib/data";

// Run reuse detection over the demo source corpus. The same call the
// rsshub-citation-toll sidecar exposes at POST /attribution/detect.

// Cap the input: detection shingles the whole string, so an unbounded body is a
// cheap CPU/memory DoS. Real agent answers are short — 20k chars is generous.
const MAX_TEXT_LENGTH = 20_000;

// Fixed-window per-IP rate limit. This is an unauthenticated, CPU-bound endpoint,
// so cap how often a single client can hit it. In-memory => per-instance only
// (good enough for a single-node demo; front a shared store for multi-instance).
const RATE_LIMIT = 30; // requests
const RATE_WINDOW_MS = 60_000; // per minute

const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Returns null if allowed, or the seconds-until-reset if the client is limited. */
function rateLimited(ip: string, now: number): number | null {
  const window = hits.get(ip);
  if (window === undefined || window.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (window.count >= RATE_LIMIT) {
    return Math.ceil((window.resetAt - now) / 1000);
  }
  window.count++;
  return null;
}

// Opportunistically evict stale windows so the map can't grow unbounded.
function sweep(now: number): void {
  if (hits.size < 10_000) return;
  for (const [ip, window] of hits) {
    if (window.resetAt <= now) hits.delete(ip);
  }
}

export async function POST(request: Request) {
  const now = Date.now();
  sweep(now);

  const retryAfter = rateLimited(clientIp(request), now);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (body === null || typeof body.text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text too long (max ${MAX_TEXT_LENGTH} characters)` },
      { status: 413 },
    );
  }

  try {
    return NextResponse.json({ data: detectGroundingForText(body.text) });
  } catch {
    return NextResponse.json({ error: "detection failed" }, { status: 500 });
  }
}

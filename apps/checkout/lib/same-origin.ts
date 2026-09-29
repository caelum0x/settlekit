/**
 * CSRF guard for state-changing checkout routes.
 *
 * Browsers attach `Origin` (and `Sec-Fetch-Site`) to cross-site POSTs. A
 * request is refused when the browser marks it cross-site, or when its
 * Origin is not this deployment (CHECKOUT_PUBLIC_URL, the forwarded host, or
 * the request host). Requests without these headers (curl, server-to-server)
 * pass: they carry no ambient buyer credentials to abuse, and every write is
 * still validated against the session.
 *
 * The Solana Pay transaction-request route is deliberately NOT guarded:
 * wallets call it cross-origin by design.
 */
import { CheckoutError } from "./errors";

function hostOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Hosts this deployment answers on. */
function allowedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const configured = hostOf(process.env.CHECKOUT_PUBLIC_URL?.trim());
  if (configured) hosts.add(configured);
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) hosts.add(forwarded);
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (host) hosts.add(host);
  const own = hostOf(request.url);
  if (own) hosts.add(own);
  return hosts;
}

/** Throw `forbidden_origin` unless `request` is same-origin (or header-less). */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new CheckoutError("forbidden_origin", "Cross-site requests are not allowed.");
  }
  const origin = request.headers.get("origin");
  if (origin === null || origin === "") return;
  const host = hostOf(origin);
  if (host === undefined || !allowedHosts(request).has(host)) {
    throw new CheckoutError("forbidden_origin", "Cross-site requests are not allowed.");
  }
}

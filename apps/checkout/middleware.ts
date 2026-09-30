// Custom storefront domains. When CHECKOUT_PRIMARY_HOSTS lists this
// checkout's own hosts, a request for "/" on any OTHER host (a merchant's
// domain pointed here by the host, e.g. Railyard or Caddy) is rewritten to
// that domain's storefront. Every other path is untouched, so payment links,
// checkouts and invoices keep working on custom domains too.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest): NextResponse {
  const primary = (process.env.CHECKOUT_PRIMARY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (primary.length === 0 || req.nextUrl.pathname !== "/") return NextResponse.next();
  const host = (req.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!host || primary.includes(host)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/store/by-domain/${encodeURIComponent(host)}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/"] };

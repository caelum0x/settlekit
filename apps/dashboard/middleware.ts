// Dashboard login gate.
//
// The merchant dashboard is a first-party app: every page needs a signed-in
// merchant whose session scopes the data it loads. This middleware redirects
// anyone without the `sk_session` cookie to /login before a protected page
// renders, so logged-out users land on sign-in instead of empty 401 pages.
//
// This is only a UX gate on cookie PRESENCE — the API independently verifies
// the session's validity and binds the tenant on every call, so a forged or
// expired cookie still yields no data.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "sk_session";

/** Paths reachable without a session (auth screens + their assets). */
const PUBLIC_PREFIXES = ["/login", "/signup"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = req.cookies.has(SESSION_COOKIE);

  // Unauthenticated → send to login, preserving where they were headed.
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already authenticated but on an auth screen → send to the dashboard home.
  if (isPublic && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on everything except Next internals, the route handlers under /api, and
// static asset files (anything with a file extension).
export const config = {
  matcher: ["/((?!_next/|api/|.*\\.[^/]+$).*)"],
};

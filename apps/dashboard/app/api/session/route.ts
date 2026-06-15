// Route handler that owns the httpOnly "sk_session" cookie.
//
// Client auth forms cannot set an httpOnly cookie from document.cookie, so
// after a successful register/login/magic-link they POST the opaque
// sessionToken here. This handler validates the shape and writes a secure,
// httpOnly, SameSite=Lax cookie. DELETE clears it (used by /logout).

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// One week, matching a typical session lifetime. The server is the source of
// truth for actual validity; this is just the cookie's max persistence.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  let token: unknown;
  try {
    const body = (await request.json()) as { sessionToken?: unknown };
    token = body.sessionToken;
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json(
      { data: null, error: "Missing sessionToken" },
      { status: 400 },
    );
  }

  const res = NextResponse.json({ data: { ok: true }, error: null });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(MAX_AGE_SECONDS));
  return res;
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ data: { ok: true }, error: null });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}

// Session cookie route handler.
//
// Owns the httpOnly "sk_session" cookie so the opaque session token is never
// exposed to client JavaScript. The client lib (lib/auth.ts) talks to this
// route instead of setting cookies directly:
//   POST   -> store the token in the cookie (after register/login/magic-link)
//   GET    -> read the token, validate it via GET /v1/auth/session, return account
//   DELETE -> revoke the token via POST /v1/auth/logout and clear the cookie
//
// Reads/clears use the same cookie name "sk_session" required by the contract.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/auth";

// This route reads cookies / performs network IO per request.
export const dynamic = "force-dynamic";

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string } | string;
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

function cookieMaxAgeDays(days: number): number {
  return days * 24 * 60 * 60;
}

/** Same-origin guard (CSRF defense beyond SameSite=Lax); browser-only route. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** Store the session token in an httpOnly cookie. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: { message: "Forbidden." } }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: { message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const sessionToken =
    payload && typeof payload === "object" && "sessionToken" in payload
      ? (payload as { sessionToken?: unknown }).sessionToken
      : undefined;

  if (typeof sessionToken !== "string" || sessionToken.length === 0) {
    return NextResponse.json(
      { data: null, error: { message: "sessionToken is required." } },
      { status: 400 },
    );
  }

  // Never trust a client-supplied token: verify it against the API before
  // persisting it (prevents session fixation / cookie injection).
  try {
    const verify = await fetch(`${API_URL}/v1/auth/session`, {
      headers: { authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
    });
    if (!verify.ok) {
      return NextResponse.json(
        { data: null, error: { message: "Invalid session token." } },
        { status: 401 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { message: err instanceof Error ? err.message : "Network error" } },
      { status: 502 },
    );
  }

  cookies().set({
    name: SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookieMaxAgeDays(30),
  });

  return NextResponse.json({ data: { ok: true }, error: null });
}

/** Validate the stored token against the API and return the account. */
export async function GET(): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { data: null, error: { message: "Not authenticated." } },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(`${API_URL}/v1/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as ApiEnvelope<{
      account: unknown;
    }> | null;

    if (!res.ok) {
      return NextResponse.json(
        {
          data: null,
          error: {
            message: errorMessage(body?.error, "Session expired."),
          },
        },
        { status: res.status },
      );
    }

    return NextResponse.json({ data: body?.data ?? null, error: null });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "Network error",
        },
      },
      { status: 502 },
    );
  }
}

/** Revoke the session server-side and clear the cookie. */
export async function DELETE(): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      await fetch(`${API_URL}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      // Best-effort revoke: clear the cookie regardless so the client logs out.
    }
  }

  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ data: { ok: true }, error: null });
}

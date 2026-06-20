// Route handler that links a wallet to the signed-in account.
//
// The session token lives in the httpOnly "sk_session" cookie (unreadable from
// client JS), so the client posts only the signed SIWE { message, signature }
// here; this handler reads the cookie server-side and forwards it as the bearer
// to POST /v1/auth/wallet/link.

import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { linkWallet, unlinkWallet } from "@/lib/auth";

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

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: "Forbidden" }, { status: 403 });
  }
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json(
      { data: null, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: { message?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; signature?: unknown };
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.message !== "string" || typeof body.signature !== "string") {
    return NextResponse.json(
      { data: null, error: "message and signature are required" },
      { status: 400 },
    );
  }

  const result = await linkWallet(token, { message: body.message, signature: body.signature });
  if (result.error || !result.data) {
    return NextResponse.json({ data: null, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: "Forbidden" }, { status: 403 });
  }
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ data: null, error: "Not signed in" }, { status: 401 });
  }
  const result = await unlinkWallet(token);
  if (result.error || !result.data) {
    return NextResponse.json({ data: null, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

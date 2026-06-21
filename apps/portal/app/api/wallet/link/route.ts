// Route handler that links a wallet to the signed-in customer.
//
// The session token lives in the httpOnly "sk_session" cookie (unreadable from
// client JS), so the client posts only the signed SIWE { message, signature };
// this handler reads the cookie server-side and forwards it as the bearer to
// POST /v1/auth/wallet/link.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, linkWalletWithToken, unlinkWalletWithToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ data: null, error: { message: "Forbidden." } }, { status: 403 });
  }

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ data: null, error: { message: "Not signed in." } }, { status: 401 });
  }

  let body: { message?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; signature?: unknown };
  } catch {
    return NextResponse.json({ data: null, error: { message: "Invalid JSON body." } }, { status: 400 });
  }
  if (typeof body.message !== "string" || typeof body.signature !== "string") {
    return NextResponse.json(
      { data: null, error: { message: "message and signature are required." } },
      { status: 400 },
    );
  }

  const result = await linkWalletWithToken(token, { message: body.message, signature: body.signature });
  if (!result.ok) {
    return NextResponse.json({ data: null, error: { message: result.error } }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: { message: "Forbidden." } }, { status: 403 });
  }

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ data: null, error: { message: "Not signed in." } }, { status: 401 });
  }

  const result = await unlinkWalletWithToken(token);
  if (!result.ok) {
    return NextResponse.json({ data: null, error: { message: result.error } }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

// Route handler that updates the signed-in customer's profile.
//
// The session token lives in the httpOnly "sk_session" cookie (unreadable from
// client JS), so the client posts only the new { displayName }; this handler
// reads the cookie server-side and forwards it as the bearer to
// PATCH /v1/auth/account.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, updateAccountWithToken } from "@/lib/auth";

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

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: { message: "Forbidden." } }, { status: 403 });
  }

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ data: null, error: { message: "Not signed in." } }, { status: 401 });
  }

  let body: { displayName?: unknown };
  try {
    body = (await request.json()) as { displayName?: unknown };
  } catch {
    return NextResponse.json({ data: null, error: { message: "Invalid JSON body." } }, { status: 400 });
  }
  if (typeof body.displayName !== "string") {
    return NextResponse.json(
      { data: null, error: { message: "displayName is required." } },
      { status: 400 },
    );
  }
  const displayName = body.displayName.trim();
  if (displayName.length < 1 || displayName.length > 120) {
    return NextResponse.json(
      { data: null, error: { message: "displayName must be 1–120 characters." } },
      { status: 400 },
    );
  }

  const result = await updateAccountWithToken(token, { displayName });
  if (!result.ok) {
    return NextResponse.json({ data: null, error: { message: result.error } }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

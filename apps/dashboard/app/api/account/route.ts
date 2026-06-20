// Route handler that updates mutable profile fields on the signed-in account.
//
// The session token lives in the httpOnly "sk_session" cookie (unreadable from
// client JS), so the client PATCHes only the editable fields here; this handler
// reads the cookie server-side and forwards it as the bearer to
// PATCH /v1/auth/account.

import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { updateAccount } from "@/lib/auth";

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
    return NextResponse.json({ data: null, error: "Forbidden" }, { status: 403 });
  }
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json(
      { data: null, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: { displayName?: unknown };
  try {
    body = (await request.json()) as { displayName?: unknown };
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.displayName !== "string") {
    return NextResponse.json(
      { data: null, error: "displayName is required" },
      { status: 400 },
    );
  }
  const displayName = body.displayName.trim();
  if (displayName.length < 1 || displayName.length > 120) {
    return NextResponse.json(
      { data: null, error: "displayName must be 1–120 characters" },
      { status: 400 },
    );
  }

  const result = await updateAccount(token, { displayName });
  if (result.error || !result.data) {
    return NextResponse.json({ data: null, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

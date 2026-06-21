// Revokes one of the signed-in account's sessions by id. Reads the sk_session
// cookie server-side, same-origin guarded, and forwards to DELETE
// /v1/auth/sessions/:id.

import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { revokeSession } from "@/lib/auth";

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

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ data: null, error: "Forbidden" }, { status: 403 });
  }
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ data: null, error: "Not signed in" }, { status: 401 });
  }
  const result = await revokeSession(token, params.id);
  if (result.error || !result.data) {
    return NextResponse.json({ data: null, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

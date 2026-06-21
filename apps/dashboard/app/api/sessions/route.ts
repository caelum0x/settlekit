// Lists the signed-in account's active sessions. The session token lives in the
// httpOnly sk_session cookie; this server route reads it and forwards it as the
// bearer to GET /v1/auth/sessions.

import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { listSessions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ data: null, error: "Not signed in" }, { status: 401 });
  }
  const result = await listSessions(token);
  if (result.error || !result.data) {
    return NextResponse.json({ data: null, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ data: result.data, error: null });
}

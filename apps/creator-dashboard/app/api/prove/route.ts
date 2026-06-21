import { NextResponse } from "next/server";
import { proveGroundingForText } from "@/lib/data";

// Detect grounding for the supplied text, then issue and verify a real signed
// proof-of-citation. The HMAC secret stays server-side inside the helper —
// only the proof's public fields and the verification outcome cross the wire.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (body === null || typeof body.text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  return NextResponse.json({ data: proveGroundingForText(body.text) });
}

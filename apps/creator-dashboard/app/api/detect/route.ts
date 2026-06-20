import { NextResponse } from "next/server";
import { detectGroundingForText } from "@/lib/data";

// Run reuse detection over the demo source corpus. The same call the
// rsshub-citation-toll sidecar exposes at POST /attribution/detect.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (body === null || typeof body.text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  return NextResponse.json({ data: detectGroundingForText(body.text) });
}

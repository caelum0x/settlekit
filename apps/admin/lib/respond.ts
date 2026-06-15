import { NextResponse } from "next/server";
import type { ApiEnvelope } from "./api";

/** Build a successful JSON envelope response. */
export function ok<T>(data: T, status = 200): NextResponse {
  const body: ApiEnvelope<T> = { ok: true, data, error: null };
  return NextResponse.json(body, { status });
}

/** Build an error JSON envelope response. */
export function fail(error: string, status = 400): NextResponse {
  const body: ApiEnvelope<never> = { ok: false, data: null, error };
  return NextResponse.json(body, { status });
}

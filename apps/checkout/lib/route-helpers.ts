/**
 * Small helpers shared by the checkout route handlers: JSON body parsing
 * and uniform `{ error, code }` replies for {@link CheckoutError}s.
 */
import { NextResponse } from "next/server";

import { CheckoutError, toRouteError } from "./errors";

/** Parse a JSON object body; throws `invalid_request` otherwise. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CheckoutError("invalid_request", "Request body must be valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new CheckoutError("invalid_request", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

/** A plain-object `fields` member of a body ({} when absent). */
export function fieldsOf(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body.fields;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Reply for a thrown error; unexpected errors are logged and hidden. */
export function errorReply(error: unknown, fallback: string, tag: string, unexpectedStatus = 500): NextResponse {
  const { status, error: message, code } = toRouteError(error, fallback);
  if (status === 500) {
    console.error(`[checkout] ${tag} failed:`, error);
    return NextResponse.json({ error: message }, { status: unexpectedStatus });
  }
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

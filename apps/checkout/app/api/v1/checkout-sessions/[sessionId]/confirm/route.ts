/**
 * POST /api/v1/checkout-sessions/:sessionId/confirm
 *
 * Body: { txHash: string, fields: Record<string,string> }
 *
 * Validates buyer fields against the session's required fields, persists them,
 * records + confirms the on-chain payment via the real @settlekit/payments
 * lifecycle, completes the session, materializes delivery, and returns the
 * receipt + delivered access.
 */
import { NextResponse } from "next/server";

import {
  getResolvedSession,
  saveCollectedFields,
  recordAndConfirm,
  getDeliveredAccess,
  getConfirmedPayment,
} from "@/lib/store";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "@/lib/fields";
import { buildReceiptView } from "@/lib/views";
import type { ConfirmPaymentRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

/** Basic on-chain tx hash shape check (0x + 64 hex), tolerant of casing. */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { sessionId } = context.params;

  const resolved = await getResolvedSession(sessionId);
  if (!resolved) {
    return NextResponse.json(
      { error: "Checkout session not found." },
      { status: 404 },
    );
  }
  if (resolved.session.status === "completed") {
    // Idempotent: already paid → return existing receipt without re-charging.
    const payment = await getConfirmedPayment(sessionId);
    const access = await getDeliveredAccess(sessionId);
    if (payment) {
      return NextResponse.json(buildReceiptView(resolved, payment, access));
    }
  }
  if (resolved.expired) {
    return NextResponse.json(
      { error: "This checkout session has expired and can no longer be paid." },
      { status: 410 },
    );
  }

  let payload: ConfirmPaymentRequest;
  try {
    payload = (await request.json()) as ConfirmPaymentRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const txHash = typeof payload?.txHash === "string" ? payload.txHash.trim() : "";
  if (!TX_HASH_RE.test(txHash)) {
    return NextResponse.json(
      { error: "A valid transaction hash (0x + 64 hex characters) is required." },
      { status: 400 },
    );
  }

  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const incoming = (payload.fields ?? {}) as Record<string, unknown>;
  const fieldErrors = validateFields(specs, incoming);
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      { error: fieldErrors.join(" ") },
      { status: 422 },
    );
  }

  const fields = sanitizeFields(specs, incoming);
  await saveCollectedFields(sessionId, fields);

  try {
    const { payment } = await recordAndConfirm(sessionId, txHash);
    const access = await getDeliveredAccess(sessionId);
    // Re-resolve to pick up persisted collected fields for the receipt buyer block.
    const after = (await getResolvedSession(sessionId)) ?? resolved;
    return NextResponse.json(buildReceiptView(after, payment, access), {
      status: 201,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to confirm payment.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

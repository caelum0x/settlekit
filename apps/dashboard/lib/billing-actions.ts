"use server";

// Server actions for subscriptions and operator-sent refunds. The session
// cookie is attached server-side; the API scopes every call to the merchant.
import { revalidatePath } from "next/cache";
import { billing, type OnchainSubscription, type SendRefundInput, type SentRefund } from "./billing";
import type { ActionResult } from "./merchant-types";

export async function cancelSubscriptionAction(id: string, atPeriodEnd: boolean): Promise<ActionResult<{ view: OnchainSubscription }>> {
  const { status: _status, ...result } = await billing.cancel(id, atPeriodEnd);
  if (!result.error) revalidatePath("/subscriptions");
  return result;
}

export async function sendRefundAction(input: SendRefundInput): Promise<ActionResult<SentRefund>> {
  if (!/^\d+(\.\d{1,6})?$/.test(input.amount.trim())) return { data: null, error: "Enter the refund amount, e.g. 25 or 25.50." };
  const { status: _status, ...result } = await billing.sendRefund({
    ...input,
    amount: input.amount.trim(),
    ...(input.to?.trim() ? { to: input.to.trim() } : {}),
  });
  if (!result.error) {
    revalidatePath(`/payments/${input.paymentId}`);
    revalidatePath("/refunds");
  }
  return result;
}

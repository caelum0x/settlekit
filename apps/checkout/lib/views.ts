/**
 * View builders: turn resolved domain objects into the JSON wire shapes the
 * pages + client consume. Keeps the route handlers thin.
 */
import {
  money,
  multiplyMoney,
  type Payment,
} from "@settlekit/common";

import { requiredFieldsForDelivery } from "./fields";
import type {
  CheckoutSessionView,
  DeliveredAccess,
  OrderLine,
  ReceiptView,
} from "./types";
import type { ResolvedSession } from "./store";

/** Build the order lines for a resolved session. */
function buildLines(resolved: ResolvedSession): OrderLine[] {
  const { session, product, price } = resolved;
  return session.lineItems.map((line) => {
    const unit = money(price.amount, price.currency);
    return {
      priceId: line.priceId,
      productId: line.productId,
      bundleId: line.bundleId,
      name: product.name,
      description: product.description,
      quantity: line.quantity,
      unitAmount: unit,
      lineTotal: multiplyMoney(unit, line.quantity),
    };
  });
}

/** Build the full session view returned to the checkout page + client. */
export function buildSessionView(
  resolved: ResolvedSession,
): CheckoutSessionView {
  const { session, deliveryAction, merchantName, expired } = resolved;
  return {
    id: session.id,
    status: session.status,
    network: session.network,
    payToAddress: session.payToAddress,
    amount: session.amount,
    lines: buildLines(resolved),
    collectedFields: session.collectedFields,
    requiredFields: requiredFieldsForDelivery(deliveryAction),
    expiresAt: session.expiresAt,
    expired,
    merchantName,
  };
}

/** Build the receipt view for a confirmed payment. */
export function buildReceiptView(
  resolved: ResolvedSession,
  payment: Payment,
  access: DeliveredAccess[],
): ReceiptView {
  return {
    sessionId: resolved.session.id,
    paymentId: payment.id,
    txHash: payment.txHash ?? "",
    network: payment.network,
    amount: payment.amount,
    confirmedAt: payment.confirmedAt ?? payment.createdAt,
    lines: buildLines(resolved),
    buyer: resolved.session.collectedFields,
    access,
  };
}

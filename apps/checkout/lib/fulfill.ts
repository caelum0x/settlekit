/**
 * Post-payment fulfillment: runs EXACTLY ONCE per confirmed payment.
 *
 * The entitlement id is derived deterministically from the payment id, so the
 * entitlement row doubles as the fulfillment ledger: if it already exists the
 * payment was fulfilled and nothing runs again. (Concurrent confirms of one
 * payment are already collapsed upstream by the unique tx-hash claim.)
 *
 * Every confirmed payment gets an entitlement via `@settlekit/entitlements`
 * `grantFromPayment`. GitHub products additionally run the REAL GitHub App
 * invite; the entitlement is `active` only when GitHub accepted it, otherwise
 * it stays `pending` (setup missing or GitHub error) — never a fake success.
 */
import { grantFromPayment, type EntitlementRepository } from "@settlekit/entitlements";
import type { DeliveryAction, Entitlement, Payment, Product } from "@settlekit/common";

import { entitlementIdForPayment } from "./deliver";
import { deliverGitHubAccess, isGitHubAction, type GitHubDelivery } from "./github-delivery";

export interface FulfillmentDeps {
  entitlements: EntitlementRepository;
  /** Resolved lazily so GitHub setup is only read when a GitHub product sells. */
  github: () => GitHubDelivery;
}

export interface FulfillInput {
  payment: Payment;
  product: Product;
  action: DeliveryAction;
  fields: Readonly<Record<string, string>>;
  now?: Date;
}

/** Fulfill `payment` once; returns the (existing or newly stored) entitlement. */
export async function fulfillPayment(deps: FulfillmentDeps, input: FulfillInput): Promise<Entitlement> {
  const { payment, product, action } = input;
  const id = entitlementIdForPayment(payment);
  const existing = await deps.entitlements.findById(id);
  if (existing) return existing;

  const now = input.now ?? new Date();
  const granted: Entitlement = {
    ...grantFromPayment({ payment, product, deliveryAction: action, now }),
    id,
  };
  if (!isGitHubAction(action)) return deps.entitlements.save(granted);

  const outcome = await deliverGitHubAccess({
    github: deps.github(),
    action,
    product,
    payment,
    entitlementId: id,
    githubUsername: input.fields.githubUsername ?? "",
    now,
  });
  if (outcome.status === "failed") {
    console.error(`[checkout] GitHub delivery failed for payment ${payment.id}: ${outcome.reason}`);
  }
  const entitlement: Entitlement =
    outcome.status === "delivered"
      ? { ...granted, status: "active", resourceId: outcome.target }
      : { ...granted, status: "pending" };
  return deps.entitlements.save(entitlement);
}

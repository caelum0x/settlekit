/**
 * Shared lookups for the customer-communication jobs.
 *
 * The worker's data layer ({@link WorkerStore}) carries `customers`
 * and `merchants` tables populated upstream by the checkout/API flow. The email
 * jobs need the buyer's address (recipient) and, where possible, merchant
 * branding for the footer. These helpers centralize that resolution so each job
 * stays focused on its own send logic.
 */

import type { Customer, Merchant, Payment } from "@settlekit/common";
import type { ReceiptLineItem } from "@settlekit/notifications";
import { money } from "@settlekit/common";
import type { JobContext } from "./types.js";

/** Resolve a buyer's contact record, or `undefined` if not yet known. */
export async function resolveCustomer(ctx: JobContext, customerId: string): Promise<Customer | undefined> {
  return ctx.stores.getCustomer(customerId);
}

/**
 * Resolve a merchant for an organization. The worker keys merchants by id, so we
 * scan for one belonging to the organization — there is exactly one merchant per
 * org in the seller-facing model.
 */
export async function resolveMerchant(ctx: JobContext, organizationId: string): Promise<Merchant | undefined> {
  return ctx.stores.findMerchantByOrg(organizationId);
}

/**
 * Build the single receipt line for a confirmed payment. The worker stores the
 * settled `Payment.amount`; we surface it as one line whose unit price is the
 * full charge (quantity 1). Multi-line invoices would expand this list, but a
 * single confirmed on-chain payment maps to one charged total.
 */
export function receiptLineItems(payment: Payment): ReceiptLineItem[] {
  return [
    {
      description: "Purchase",
      quantity: 1,
      unitPrice: money(payment.amount.amount, payment.amount.currency),
    },
  ];
}

/**
 * Buyer billing details for tax: the billing country picks the seller's
 * rate and an EU VAT ID can zero-rate a cross-border B2B sale (reverse
 * charge). Allowed while the session is open and nothing is recorded against
 * it; the amount due is recomputed from the net price (a locked Zcash quote
 * is re-priced).
 */
import type { CheckoutSession } from "@settlekit/common";
import { normalizeCountry, withSessionTax } from "@settlekit/persistence";

import { CheckoutError } from "./errors";
import { bindAndSave, switchableSession } from "./network-select";
import { defaultStoreDeps, type StoreDeps } from "./store";

export async function applyBuyerTax(
  sessionId: string,
  input: { country?: unknown; vatId?: unknown },
  deps: StoreDeps = defaultStoreDeps(),
  now: Date = new Date(),
): Promise<CheckoutSession> {
  const country = typeof input.country === "string" ? normalizeCountry(input.country) : undefined;
  if (!country) throw new CheckoutError("invalid_request", "Choose your billing country.");
  const vatRaw = typeof input.vatId === "string" ? input.vatId.trim() : "";
  if (vatRaw.length > 20 || (vatRaw.length > 0 && !/^[A-Za-z0-9 .+*-]+$/.test(vatRaw))) {
    throw new CheckoutError("invalid_request", "Enter a valid VAT ID or leave it empty.");
  }
  const session = await switchableSession(sessionId, deps, now);
  if (session.invoiceId !== undefined) {
    throw new CheckoutError("invalid_request", "Tax on invoices is set by the seller.");
  }
  const settings = await deps.backend.taxSettings?.(session.organizationId);
  if (!settings?.enabled) throw new CheckoutError("invalid_request", "This seller does not charge tax at checkout.");
  const taxed = withSessionTax(session, settings, { country, ...(vatRaw ? { vatId: vatRaw } : {}) });
  const { settlementQuote: _stale, ...rest } = taxed;
  void _stale;
  return bindAndSave(rest, session.network, deps, now);
}

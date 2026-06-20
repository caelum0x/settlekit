/**
 * Boundary validation for off-ramp requests. Every public provider method runs
 * inputs through here first, returning `err(validationError(...))` for any
 * expected, business-level problem (bad amount, unknown currency, missing
 * beneficiary). All pure and fully unit-testable.
 */

import {
  type Result,
  type SettleKitError,
  compareMoney,
  err,
  money,
  ok,
  validationError,
} from "@settlekit/common";
import type {
  Beneficiary,
  OffRampQuoteRequest,
  PayoutMethod,
  PayoutRequest,
} from "./types.js";

/**
 * ISO-4217 destination currencies we currently support off-ramping into.
 * Intentionally conservative — extend as rails are certified.
 */
const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "MXN", "BRL"]);

/** Payout rails we accept. */
const SUPPORTED_METHODS = new Set<PayoutMethod>(["bank_account"]);

const COUNTRY_RE = /^[A-Z]{2}$/;

/** A validated quote request, narrowed for downstream use. */
export type ValidatedQuoteRequest = OffRampQuoteRequest;

/** A validated payout request, narrowed for downstream use. */
export type ValidatedPayoutRequest = PayoutRequest;

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse + validate a USDC amount string. money() throws RangeError on malformed
 * input, so it is wrapped here and converted to a validation error — no raw
 * RangeError ever escapes a provider boundary. Also enforces strict positivity.
 */
function validateAmount(amountUsdc: string): Result<true> {
  if (!nonEmpty(amountUsdc)) {
    return err(validationError("amountUsdc is required"));
  }
  let parsed;
  try {
    parsed = money(amountUsdc);
  } catch (error) {
    return err(
      validationError(`amountUsdc is not a valid USDC amount: ${amountUsdc}`, {
        amountUsdc,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  if (compareMoney(parsed, money("0")) !== 1) {
    return err(validationError("amountUsdc must be greater than zero", { amountUsdc }));
  }
  return ok(true);
}

function validateCurrency(destinationCurrency: string): Result<true> {
  if (!nonEmpty(destinationCurrency) || !SUPPORTED_CURRENCIES.has(destinationCurrency)) {
    return err(
      validationError(`destinationCurrency is not a supported ISO-4217 code: ${destinationCurrency}`, {
        destinationCurrency,
        supported: [...SUPPORTED_CURRENCIES],
      }),
    );
  }
  return ok(true);
}

function validateCountry(country: string, field: string): Result<true> {
  if (!nonEmpty(country) || !COUNTRY_RE.test(country)) {
    return err(
      validationError(`${field} must be an ISO-3166 alpha-2 country code`, { [field]: country }),
    );
  }
  return ok(true);
}

function validateMethod(payoutMethod: PayoutMethod): Result<true> {
  if (!SUPPORTED_METHODS.has(payoutMethod)) {
    return err(
      validationError(`payoutMethod is not supported: ${payoutMethod}`, {
        payoutMethod,
        supported: [...SUPPORTED_METHODS],
      }),
    );
  }
  return ok(true);
}

function validateBeneficiary(beneficiary: Beneficiary, method: PayoutMethod): Result<true> {
  if (beneficiary === undefined || beneficiary === null) {
    return err(validationError("beneficiary is required"));
  }
  if (!nonEmpty(beneficiary.name)) {
    return err(validationError("beneficiary.name is required"));
  }
  const country = validateCountry(beneficiary.country, "beneficiary.country");
  if (!country.ok) return country;
  if (method === "bank_account" && !nonEmpty(beneficiary.accountNumber)) {
    return err(
      validationError("beneficiary.accountNumber is required for bank_account payouts"),
    );
  }
  return ok(true);
}

/** Validate a quote request at the boundary. */
export function validateQuoteRequest(
  req: OffRampQuoteRequest,
): Result<ValidatedQuoteRequest, SettleKitError> {
  if (!nonEmpty(req.reference)) {
    return err(validationError("reference is required"));
  }
  const amount = validateAmount(req.amountUsdc);
  if (!amount.ok) return amount;
  const currency = validateCurrency(req.destinationCurrency);
  if (!currency.ok) return currency;
  const method = validateMethod(req.payoutMethod);
  if (!method.ok) return method;
  const country = validateCountry(req.beneficiaryCountry, "beneficiaryCountry");
  if (!country.ok) return country;
  return ok(req);
}

/** Validate a payout request at the boundary. */
export function validatePayoutRequest(
  req: PayoutRequest,
): Result<ValidatedPayoutRequest, SettleKitError> {
  if (!nonEmpty(req.reference)) {
    return err(validationError("reference is required"));
  }
  const amount = validateAmount(req.amountUsdc);
  if (!amount.ok) return amount;
  const currency = validateCurrency(req.destinationCurrency);
  if (!currency.ok) return currency;
  const method = validateMethod(req.payoutMethod);
  if (!method.ok) return method;
  const beneficiary = validateBeneficiary(req.beneficiary, req.payoutMethod);
  if (!beneficiary.ok) return beneficiary;
  return ok(req);
}

import { compareMoney, isErr, isOk, money, SettleKitError } from "@settlekit/common";
import { describe, expect, it, vi } from "vitest";
import {
  CpnOffRampProvider,
  type CpnHttpClient,
  type CpnPayoutResponse,
  type CpnQuoteResponse,
} from "../src/cpn-provider.js";
import { configureOffRamp } from "../src/configure.js";
import { offRampProviderFromEnv } from "../src/env.js";
import { LocalOffRampProvider } from "../src/local-provider.js";
import { feeForAmount } from "../src/quote-math.js";
import type { OffRampQuoteRequest, PayoutRequest } from "../src/types.js";
import { validatePayoutRequest, validateQuoteRequest } from "../src/validate.js";

const quoteReq: OffRampQuoteRequest = {
  reference: "ref-quote-1",
  amountUsdc: "100",
  destinationCurrency: "USD",
  payoutMethod: "bank_account",
  beneficiaryCountry: "US",
};

const payoutReq: PayoutRequest = {
  reference: "ref-payout-1",
  amountUsdc: "100",
  destinationCurrency: "USD",
  payoutMethod: "bank_account",
  beneficiary: {
    name: "Ada Lovelace",
    country: "US",
    accountNumber: "000123456789",
    routingNumber: "021000021",
  },
  memo: "june royalties",
};

describe("validate", () => {
  it("accepts a well-formed quote request", () => {
    const r = validateQuoteRequest(quoteReq);
    expect(isOk(r)).toBe(true);
  });

  it("accepts a well-formed payout request", () => {
    const r = validatePayoutRequest(payoutReq);
    expect(isOk(r)).toBe(true);
  });

  it.each([
    ["empty reference", { ...quoteReq, reference: "" }],
    ["non-numeric amount", { ...quoteReq, amountUsdc: "abc" }],
    ["negative amount", { ...quoteReq, amountUsdc: "-5" }],
    ["zero amount", { ...quoteReq, amountUsdc: "0" }],
    ["too many decimals", { ...quoteReq, amountUsdc: "1.1234567" }],
    ["unknown currency", { ...quoteReq, destinationCurrency: "XXX" }],
    ["bad country", { ...quoteReq, beneficiaryCountry: "USA" }],
  ])("rejects %s with validation_error", (_label, req) => {
    const r = validateQuoteRequest(req as OffRampQuoteRequest);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error).toBeInstanceOf(SettleKitError);
      expect(r.error.code).toBe("validation_error");
    }
  });

  it("rejects a payout missing the beneficiary account number", () => {
    const r = validatePayoutRequest({
      ...payoutReq,
      beneficiary: { ...payoutReq.beneficiary, accountNumber: "" },
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("validation_error");
  });
});

describe("LocalOffRampProvider.quote", () => {
  it("returns a deterministic 1.0 rate with a 0.5% fee and future expiry", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const provider = new LocalOffRampProvider({ clock: () => now });
    const r = await provider.quote(quoteReq);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const q = r.value;
    expect(q.rate).toBe("1");
    expect(q.provider).toBe("local");
    // 0.5% of 100 = 0.5 USDC fee, 99.5 destination.
    expect(compareMoney(q.feeUsdc, feeForAmount(money("100")))).toBe(0);
    expect(q.feeUsdc.amount).toBe("0.5");
    expect(q.destinationAmount).toBe("99.5");
    expect(new Date(q.expiresAt).getTime()).toBeGreaterThan(now.getTime());
  });

  it("propagates validation failures from quote()", async () => {
    const provider = new LocalOffRampProvider();
    const r = await provider.quote({ ...quoteReq, amountUsdc: "0" });
    expect(isErr(r)).toBe(true);
  });
});

describe("LocalOffRampProvider.initiatePayout", () => {
  it("records a paid receipt and is idempotent on reference", async () => {
    const provider = new LocalOffRampProvider();
    const first = await provider.initiatePayout(payoutReq);
    const second = await provider.initiatePayout(payoutReq);
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;

    expect(first.value.status).toBe("paid");
    expect(first.value.cpnTransferId).toMatch(/^cpn_local_/);
    // Idempotent: same id, only one recorded receipt.
    expect(second.value.id).toBe(first.value.id);
    expect(provider.all()).toHaveLength(1);
    expect(compareMoney(provider.totalVolume(), money("100"))).toBe(0);
  });

  it("reads a payout back via getPayoutStatus", async () => {
    const provider = new LocalOffRampProvider();
    await provider.initiatePayout(payoutReq);
    const status = await provider.getPayoutStatus(payoutReq.reference);
    expect(isOk(status)).toBe(true);
    if (isOk(status)) expect(status.value.status).toBe("paid");
  });

  it("returns not_found for an unknown reference", async () => {
    const provider = new LocalOffRampProvider();
    const status = await provider.getPayoutStatus("nope");
    expect(isErr(status)).toBe(true);
    if (isErr(status)) expect(status.error.code).toBe("not_found");
  });
});

describe("configureOffRamp", () => {
  it("selects the local provider", () => {
    expect(configureOffRamp({ provider: "local" }).name).toBe("local");
  });
  it("selects the cpn provider", () => {
    expect(configureOffRamp({ provider: "cpn", config: {} }).name).toBe("cpn");
  });
});

describe("offRampProviderFromEnv", () => {
  it("defaults to local with empty env", () => {
    expect(offRampProviderFromEnv({}).name).toBe("local");
  });
  it("falls back to local when cpn is requested but creds missing", () => {
    expect(offRampProviderFromEnv({ PAYOUTS_OFFRAMP_PROVIDER: "cpn" }).name).toBe("local");
  });
  it("selects cpn when api key is present", () => {
    const provider = offRampProviderFromEnv({
      PAYOUTS_OFFRAMP_PROVIDER: "cpn",
      CIRCLE_CPN_API_KEY: "sk_test_123",
    });
    expect(provider.name).toBe("cpn");
  });
});

describe("CpnOffRampProvider without credentials", () => {
  it("throws a typed integration_error on quote()", async () => {
    const provider = new CpnOffRampProvider();
    await expect(provider.quote(quoteReq)).rejects.toMatchObject({
      code: "integration_error",
    });
    await expect(provider.quote(quoteReq)).rejects.toThrow(/CIRCLE_CPN/);
  });

  it("throws a typed integration_error on initiatePayout()", async () => {
    const provider = new CpnOffRampProvider();
    await expect(provider.initiatePayout(payoutReq)).rejects.toBeInstanceOf(SettleKitError);
    await expect(provider.initiatePayout(payoutReq)).rejects.toMatchObject({
      code: "integration_error",
    });
  });

  it("still returns validation errors (not the cred error) for bad input", async () => {
    const provider = new CpnOffRampProvider();
    const r = await provider.quote({ ...quoteReq, amountUsdc: "0" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("validation_error");
  });
});

describe("CpnOffRampProvider with injected http client", () => {
  function fakeClient(): CpnHttpClient & {
    requestQuote: ReturnType<typeof vi.fn>;
    createPayout: ReturnType<typeof vi.fn>;
  } {
    const quoteResp: CpnQuoteResponse = {
      rate: "0.99",
      destinationAmount: "98.5",
      feeUsdc: "0.5",
      expiresAt: "2026-06-20T00:05:00.000Z",
      quoteId: "cpn_q_1",
    };
    const payoutResp: CpnPayoutResponse = {
      transferId: "cpn_tx_1",
      status: "paid",
      destinationAmount: "98.5",
    };
    return {
      requestQuote: vi.fn(async () => quoteResp),
      createPayout: vi.fn(async () => payoutResp),
    };
  }

  it("maps a quote response and forwards reference as the CPN key", async () => {
    const http = fakeClient();
    const provider = new CpnOffRampProvider({
      credentials: { apiKey: "sk", baseUrl: "https://api.circle.com" },
      http,
    });
    const r = await provider.quote(quoteReq);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.id).toBe("cpn_q_1");
    expect(r.value.rate).toBe("0.99");
    expect(http.requestQuote).toHaveBeenCalledWith(
      expect.objectContaining({ reference: quoteReq.reference }),
    );
  });

  it("maps a payout response, uses reference as idempotency key, dedupes retries", async () => {
    const http = fakeClient();
    const provider = new CpnOffRampProvider({
      credentials: { apiKey: "sk", baseUrl: "https://api.circle.com" },
      http,
    });
    const first = await provider.initiatePayout(payoutReq);
    const second = await provider.initiatePayout(payoutReq);
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;

    expect(first.value.status).toBe("paid");
    expect(first.value.cpnTransferId).toBe("cpn_tx_1");
    expect(first.value.provider).toBe("cpn");
    // reference passed as the CPN idempotency key.
    expect(http.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: payoutReq.reference, reference: payoutReq.reference }),
    );
    // Deduped: the live call happens exactly once across both attempts.
    expect(http.createPayout).toHaveBeenCalledTimes(1);
    expect(second.value.id).toBe(first.value.id);
  });

  it("maps a failed CPN status onto a failed receipt with a reason", async () => {
    const http = fakeClient();
    http.createPayout.mockResolvedValueOnce({
      transferId: "cpn_tx_2",
      status: "failed",
      destinationAmount: "0",
      failureReason: "beneficiary account closed",
    } satisfies CpnPayoutResponse);
    const provider = new CpnOffRampProvider({
      credentials: { apiKey: "sk", baseUrl: "https://api.circle.com" },
      http,
    });
    const r = await provider.initiatePayout({ ...payoutReq, reference: "ref-fail" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.status).toBe("failed");
    expect(r.value.failureReason).toBe("beneficiary account closed");
    expect(r.value.settledAt).toBeUndefined();
  });
});

describe("CpnOffRampProvider.estimateFee", () => {
  it("computes fee + net without a network call", () => {
    const provider = new CpnOffRampProvider();
    const r = provider.estimateFee("200");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.feeUsdc).toBe("1");
      expect(r.value.netUsdc).toBe("199");
    }
  });
  it("returns validation_error for a bad amount", () => {
    const provider = new CpnOffRampProvider();
    const r = provider.estimateFee("nope");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("validation_error");
  });
});

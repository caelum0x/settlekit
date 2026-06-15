import { describe, expect, it } from "vitest";
import {
  buildPaymentRequiredResponse,
  encodePaymentHeader,
  parsePaymentHeader,
  withSettleKitPayment,
  type PaymentProof,
  type PaymentVerifier,
  type SettleAndMeterContext,
} from "../src/index.js";

const BASE_CONFIG = {
  price: "0.005",
  currency: "USDC" as const,
  productId: "prod_test",
  network: "arc" as const,
  payTo: "0xMerchantWallet",
};

const PROOF: PaymentProof = {
  txHash: "0xdeadbeef",
  from: "0xBuyerWallet",
  amount: "0.005",
  network: "arc",
  nonce: "challenge-nonce",
};

/** Real in-memory implementations of the host-supplied verifier interface. */
const alwaysPass: PaymentVerifier = async () => ({ ok: true });
const alwaysFail: PaymentVerifier = async () => ({ ok: false, reason: "tx not found on-chain" });

function paidRequest(proof: PaymentProof = PROOF): Request {
  return new Request("https://api.example.com/secret", {
    headers: { "X-Payment": encodePaymentHeader(proof) },
  });
}

describe("buildPaymentRequiredResponse", () => {
  it("returns a 402 with x402 requirements in body and headers", async () => {
    const res = buildPaymentRequiredResponse({
      ...BASE_CONFIG,
      resource: "https://api.example.com/secret",
      nonce: "fixed-nonce",
    });

    expect(res.status).toBe(402);

    const body = (await res.json()) as {
      error: string;
      accepts: Array<Record<string, unknown>>;
    };
    expect(body.error).toBe("payment_required");
    const req = body.accepts[0]!;
    expect(req).toMatchObject({
      scheme: "x402",
      amount: "0.005",
      asset: "USDC",
      network: "arc",
      payTo: "0xMerchantWallet",
      productId: "prod_test",
      resource: "https://api.example.com/secret",
      nonce: "fixed-nonce",
    });

    const header = res.headers.get("X-Payment-Required");
    expect(header).not.toBeNull();
    expect(JSON.parse(header!)).toMatchObject({ scheme: "x402", nonce: "fixed-nonce" });
    expect(res.headers.get("Accept-Payment")).toBe(header);
  });

  it("generates a random nonce when none is supplied", () => {
    const a = buildPaymentRequiredResponse({ ...BASE_CONFIG, resource: "r" });
    const b = buildPaymentRequiredResponse({ ...BASE_CONFIG, resource: "r" });
    const na = JSON.parse(a.headers.get("X-Payment-Required")!).nonce as string;
    const nb = JSON.parse(b.headers.get("X-Payment-Required")!).nonce as string;
    expect(na.length).toBeGreaterThan(0);
    expect(na).not.toBe(nb);
  });

  it("rejects non-USDC currencies", () => {
    expect(() =>
      buildPaymentRequiredResponse({
        ...BASE_CONFIG,
        currency: "EUR" as unknown as "USDC",
        resource: "r",
      }),
    ).toThrow(/USDC/);
  });
});

describe("parsePaymentHeader", () => {
  it("returns ok(null) when the header is absent", () => {
    const result = parsePaymentHeader(new Request("https://api.example.com/secret"));
    expect(result).toEqual({ ok: true, value: null });
  });

  it("decodes a valid base64 JSON proof", () => {
    const result = parsePaymentHeader(paidRequest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(PROOF);
  });

  it("errors on invalid base64", () => {
    const req = new Request("https://api.example.com/secret", {
      headers: { "X-Payment": "%%%not-base64%%%" },
    });
    const result = parsePaymentHeader(req);
    expect(result.ok).toBe(false);
  });

  it("errors on a structurally invalid proof", () => {
    const bad = Buffer.from(JSON.stringify({ txHash: "0x1" }), "utf-8").toString("base64");
    const req = new Request("https://api.example.com/secret", {
      headers: { "X-Payment": bad },
    });
    const result = parsePaymentHeader(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/from/);
  });
});

describe("withSettleKitPayment", () => {
  it("returns 402 with correct JSON when the payment header is missing", async () => {
    const handler = withSettleKitPayment({ ...BASE_CONFIG, verify: alwaysPass })(() =>
      Response.json({ ok: true }),
    );

    const res = await handler(new Request("https://api.example.com/secret"));
    expect(res.status).toBe(402);

    const body = (await res.json()) as { error: string; accepts: Array<{ scheme: string }> };
    expect(body.error).toBe("payment_required");
    expect(body.accepts[0]!.scheme).toBe("x402");
    expect(body.accepts[0]).toMatchObject({ amount: "0.005", payTo: "0xMerchantWallet" });
  });

  it("runs the handler when a valid header passes verification", async () => {
    let handlerRan = false;
    const handler = withSettleKitPayment({ ...BASE_CONFIG, verify: alwaysPass })((req) => {
      handlerRan = true;
      expect(req.url).toBe("https://api.example.com/secret");
      return Response.json({ data: "secret-payload" });
    });

    const res = await handler(paidRequest());
    expect(handlerRan).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "secret-payload" });
  });

  it("returns 402 with the reason when verification fails", async () => {
    let handlerRan = false;
    const handler = withSettleKitPayment({ ...BASE_CONFIG, verify: alwaysFail })(() => {
      handlerRan = true;
      return Response.json({ ok: true });
    });

    const res = await handler(paidRequest());
    expect(handlerRan).toBe(false);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("tx not found on-chain");
  });

  it("passes the parsed proof and requirements to the verifier", async () => {
    let seenProof: PaymentProof | undefined;
    let seenNonceLen = 0;
    const verify: PaymentVerifier = async (proof, requirements) => {
      seenProof = proof;
      seenNonceLen = requirements.nonce.length;
      expect(requirements.resource).toBe("https://api.example.com/secret");
      expect(requirements.amount).toBe("0.005");
      return { ok: true };
    };

    const handler = withSettleKitPayment({ ...BASE_CONFIG, verify })(() =>
      Response.json({ ok: true }),
    );
    await handler(paidRequest());

    expect(seenProof).toEqual(PROOF);
    expect(seenNonceLen).toBeGreaterThan(0);
  });

  it("fires the settleAndMeter hook after a successful paid call", async () => {
    let metered: SettleAndMeterContext | undefined;
    const handler = withSettleKitPayment({
      ...BASE_CONFIG,
      verify: alwaysPass,
      settleAndMeter: (ctx) => {
        metered = ctx;
      },
    })(() => Response.json({ ok: true }));

    const res = await handler(paidRequest());
    expect(res.status).toBe(200);
    expect(metered).toBeDefined();
    expect(metered!.proof).toEqual(PROOF);
    expect(metered!.response.status).toBe(200);
    expect(metered!.requirements.productId).toBe("prod_test");
  });

  it("does not fire settleAndMeter when verification fails", async () => {
    let fired = false;
    const handler = withSettleKitPayment({
      ...BASE_CONFIG,
      verify: alwaysFail,
      settleAndMeter: () => {
        fired = true;
      },
    })(() => Response.json({ ok: true }));

    await handler(paidRequest());
    expect(fired).toBe(false);
  });

  it("swallows errors thrown by the settleAndMeter hook", async () => {
    const handler = withSettleKitPayment({
      ...BASE_CONFIG,
      verify: alwaysPass,
      settleAndMeter: () => {
        throw new Error("metering backend down");
      },
    })(() => Response.json({ data: "ok" }));

    const res = await handler(paidRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "ok" });
  });

  it("challenges with a reason when the header is malformed", async () => {
    const handler = withSettleKitPayment({ ...BASE_CONFIG, verify: alwaysPass })(() =>
      Response.json({ ok: true }),
    );
    const req = new Request("https://api.example.com/secret", {
      headers: { "X-Payment": "not base64 at all !!!" },
    });
    const res = await handler(req);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBeDefined();
  });
});

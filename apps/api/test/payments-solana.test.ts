/**
 * Solana checkout + the fail-closed verifier registry.
 *
 * Drives product -> price -> customer -> solana checkout session -> payment
 * -> confirm through the real routes, with verifiers injected per test:
 *   - no verifier for the network   -> confirm/observe rejected (fail closed)
 *   - the REAL Solana verifier over a canned jsonParsed transaction
 *   - a transaction hash can settle only one payment (409 on reuse)
 *   - regression: Base without a verifier can no longer be confirmed
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import {
  USDC_MINT_MAINNET,
  createSolanaPaymentVerifier,
  isReference,
  type ParsedTransaction,
  type SolanaRpc,
} from "@settlekit/solana";
import type { PaymentProof, PaymentRequirements, PaymentVerifier, VerifyResult } from "@settlekit/x402";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";
import type { PaymentVerifiers } from "../src/config/integrations.js";

const BOOTSTRAP = "test-bootstrap-key";
const MERCHANT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const MERCHANT_ATA = "5ZGPSxMzV9xV5s3Wep73r8k5MsPAtLYs11dGDdknznM5";
const BUYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BUYER_ATA = "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SIG_A =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const SIG_B =
  "52GmBTh77RXNGktVtjZJtUGZy2BPsrvaPHbhH5AZAgS4xtT21SzVExMtHbRD9dGNBwMXPkjGPTyWDNQmV1nCKGQy";

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

async function appWith(verifiers: PaymentVerifiers): Promise<Hono<AppEnv>> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const ctx = await createContext();
  return createApp({ ...ctx, verifiers });
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

/** Create product/price/customer and an open checkout session + pending payment. */
async function openSessionWithPayment(
  app: Hono<AppEnv>,
  network: "solana" | "base" = "solana",
): Promise<{ sessionId: string; paymentId: string; customerId: string; productId: string; reference?: string }> {
  const product = await call(app, "POST", "/v1/products", {
    merchantId: "mch_1",
    organizationId: "org_1",
    name: "Private Repo",
    description: "Source access",
    type: "github_repo_access",
    deliveryMode: "github_invite",
  });
  const productId = product.json.data.id as string;
  const price = await call(app, "POST", `/v1/products/${productId}/prices`, {
    amount: "25.00",
    interval: "one_time",
  });
  const customer = await call(app, "POST", "/v1/customers", {
    organizationId: "org_1",
    email: "buyer@example.com",
  });
  const customerId = customer.json.data.id as string;
  const checkout = await call(app, "POST", "/v1/checkout-sessions", {
    merchantId: "mch_1",
    customerId,
    items: [{ priceId: price.json.data.id, productId, quantity: 1 }],
    payToAddress: network === "solana" ? MERCHANT : "0x1111111111111111111111111111111111111111",
    network,
  });
  expect(checkout.status).toBe(201);
  const payment = await call(app, "POST", "/v1/payments", { checkoutSessionId: checkout.json.data.id });
  expect(payment.status).toBe(201);
  return {
    sessionId: checkout.json.data.id as string,
    paymentId: payment.json.data.id as string,
    customerId,
    productId,
    ...(checkout.json.data.paymentReference ? { reference: checkout.json.data.paymentReference as string } : {}),
  };
}

/** A jsonParsed USDC payment (25 USDC buyer -> merchant) including `reference`. */
function usdcPaymentTx(signature: string, reference: string | null, amount = 25_000_000n): ParsedTransaction {
  const bal = (accountIndex: number, owner: string, value: bigint) => ({
    accountIndex,
    mint: USDC_MINT_MAINNET,
    owner,
    programId: TOKEN_PROGRAM,
    uiTokenAmount: { amount: value.toString(), decimals: 6, uiAmount: Number(value) / 1e6, uiAmountString: String(Number(value) / 1e6) },
  });
  const key = (pubkey: string, signer: boolean, writable: boolean) => ({ pubkey, signer, writable, source: "transaction" });
  return {
    slot: 291_550_123,
    blockTime: 1_727_600_000,
    version: 0,
    meta: {
      err: null,
      fee: 5_000,
      preTokenBalances: [bal(1, BUYER, 100_000_000n), bal(2, MERCHANT, 0n)],
      postTokenBalances: [bal(1, BUYER, 100_000_000n - amount), bal(2, MERCHANT, amount)],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [
          key(BUYER, true, true),
          key(BUYER_ATA, false, true),
          key(MERCHANT_ATA, false, true),
          key(MERCHANT, false, false),
          key(USDC_MINT_MAINNET, false, false),
          ...(reference ? [key(reference, false, false)] : []),
          key(TOKEN_PROGRAM, false, false),
        ],
      },
    },
  };
}

function rpcServing(transactions: Record<string, ParsedTransaction>): SolanaRpc {
  const unused = async (): Promise<never> => {
    throw new Error("not used by verification");
  };
  return {
    getTransaction: async (signature) => transactions[signature] ?? null,
    getSignaturesForAddress: unused,
    getLatestBlockhash: unused,
    sendTransaction: unused,
    getSignatureStatuses: unused,
  };
}

function recordingVerifier(result: VerifyResult = { ok: true }): PaymentVerifier & {
  seen: Array<{ proof: PaymentProof; requirements: PaymentRequirements & { reference?: string } }>;
} {
  const seen: Array<{ proof: PaymentProof; requirements: PaymentRequirements & { reference?: string } }> = [];
  const verifier = (async (proof: PaymentProof, requirements: PaymentRequirements) => {
    seen.push({ proof, requirements });
    return result;
  }) as PaymentVerifier & { seen: typeof seen };
  verifier.seen = seen;
  return verifier;
}

describe("solana checkout sessions", () => {
  it("issues a Solana Pay reference for solana sessions only", async () => {
    const app = await appWith({});
    const solana = await openSessionWithPayment(app, "solana");
    expect(solana.reference && isReference(solana.reference)).toBe(true);
    const base = await openSessionWithPayment(app, "base");
    expect(base.reference).toBeUndefined();
  });

  it("rejects a non-base58 payTo for network solana", async () => {
    const app = await appWith({});
    const res = await call(app, "POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      items: [{ priceId: "price_x" }],
      payToAddress: "0xMerchantWallet",
      network: "solana",
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("validation_error");
  });
});

describe("POST /v1/payments/:id/confirm (fail closed)", () => {
  it("rejects a solana confirmation when no solana verifier is configured", async () => {
    const app = await appWith({});
    const { paymentId, customerId, productId } = await openSessionWithPayment(app);

    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "solana"/);

    const payment = await call(app, "GET", `/v1/payments/${paymentId}`);
    expect(payment.json.data.status).toBe("pending");
    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(false);
  });

  it("confirms via a verifier and grants the entitlement, passing payTo/amount/reference", async () => {
    const verifier = recordingVerifier();
    const app = await appWith({ solana: verifier });
    const { paymentId, customerId, productId, sessionId, reference } = await openSessionWithPayment(app);

    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(res.status).toBe(200);
    expect(res.json.data.payment.status).toBe("confirmed");
    expect(res.json.data.payment.txHash).toBe(SIG_A);
    expect(res.json.data.entitlements).toHaveLength(1);

    expect(verifier.seen).toHaveLength(1);
    expect(verifier.seen[0]?.proof).toMatchObject({ txHash: SIG_A, network: "solana" });
    expect(verifier.seen[0]?.requirements).toMatchObject({
      network: "solana",
      payTo: MERCHANT,
      amount: "25",
      reference,
      resource: `checkout_session:${sessionId}`,
    });

    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(true);
  });

  it("surfaces the verifier's rejection reason and does not confirm", async () => {
    const app = await appWith({ solana: recordingVerifier({ ok: false, reason: "underpaid" }) });
    const { paymentId } = await openSessionWithPayment(app);
    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/underpaid/);
  });

  it("returns 409 when a transaction hash is reused for a second payment", async () => {
    const app = await appWith({ solana: recordingVerifier() });
    const first = await openSessionWithPayment(app);
    const second = await openSessionWithPayment(app);

    const ok = await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(ok.status).toBe(200);
    // Idempotent re-confirm of the SAME payment with the same hash is allowed.
    const again = await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(again.status).toBe(200);

    const replay = await call(app, "POST", `/v1/payments/${second.paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(replay.status).toBe(409);
    expect(replay.json.error?.code).toBe("conflict");
    const stillPending = await call(app, "GET", `/v1/payments/${second.paymentId}`);
    expect(stillPending.json.data.status).toBe("pending");

    // Recording a new pending payment with an already-used hash is refused too.
    const squat = await call(app, "POST", "/v1/payments", { checkoutSessionId: second.sessionId, txHash: SIG_A });
    expect(squat.status).toBe(409);
  });

  it("treats EVM hashes case-insensitively for uniqueness", async () => {
    const app = await appWith({ base: recordingVerifier() });
    const first = await openSessionWithPayment(app, "base");
    const second = await openSessionWithPayment(app, "base");
    const hash = `0x${"ab".repeat(32)}`;
    expect((await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: hash, confirmations: 3 })).status).toBe(200);
    const upper = await call(app, "POST", `/v1/payments/${second.paymentId}/confirm`, {
      txHash: `0x${"AB".repeat(32)}`,
      confirmations: 3,
    });
    expect(upper.status).toBe(409);
  });

  it("regression: a base payment cannot be confirmed without a base verifier", async () => {
    const app = await appWith({ solana: recordingVerifier() });
    const { paymentId, customerId, productId } = await openSessionWithPayment(app, "base");
    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, {
      txHash: "0xdeadbeef",
      confirmations: 50,
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "base"/);
    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(false);
  });
});

describe("confirm with the REAL Solana verifier over a canned transaction", () => {
  it("accepts the tx carrying the session reference and rejects one without it", async () => {
    const transactions: Record<string, ParsedTransaction> = {};
    const verifier = createSolanaPaymentVerifier({ rpc: rpcServing(transactions), mint: USDC_MINT_MAINNET });
    const app = await appWith({ solana: verifier });

    const withRef = await openSessionWithPayment(app);
    const withoutRef = await openSessionWithPayment(app);
    transactions[SIG_A] = usdcPaymentTx(SIG_A, withRef.reference ?? null);
    transactions[SIG_B] = usdcPaymentTx(SIG_B, null);

    const ok = await call(app, "POST", `/v1/payments/${withRef.paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(ok.status).toBe(200);
    expect(ok.json.data.entitlements).toHaveLength(1);

    const missing = await call(app, "POST", `/v1/payments/${withoutRef.paymentId}/confirm`, {
      txHash: SIG_B,
      confirmations: 1,
    });
    expect(missing.status).toBe(400);
    expect(missing.json.error?.message).toMatch(/reference/);
  });

  it("rejects an underpaid transfer", async () => {
    const transactions: Record<string, ParsedTransaction> = {};
    const app = await appWith({
      solana: createSolanaPaymentVerifier({ rpc: rpcServing(transactions), mint: USDC_MINT_MAINNET }),
    });
    const session = await openSessionWithPayment(app);
    transactions[SIG_A] = usdcPaymentTx(SIG_A, session.reference ?? null, 24_999_999n);
    const res = await call(app, "POST", `/v1/payments/${session.paymentId}/confirm`, { txHash: SIG_A, confirmations: 1 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/expected at least 25000000/);
  });
});

describe("POST /v1/payments/observe (network-aware)", () => {
  const observe = { txHash: SIG_A, to: MERCHANT, amount: "25", network: "solana", from: BUYER };

  it("fails closed without a solana verifier", async () => {
    const app = await appWith({});
    const res = await call(app, "POST", "/v1/payments/observe", observe);
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "solana"/);
  });

  it("validates base58 formats for solana and 0x formats for EVM", async () => {
    const app = await appWith({ solana: recordingVerifier(), arc: recordingVerifier() });
    const evmHashOnSolana = await call(app, "POST", "/v1/payments/observe", { ...observe, txHash: `0x${"ab".repeat(32)}` });
    expect(evmHashOnSolana.status).toBe(400);
    const solanaHashOnArc = await call(app, "POST", "/v1/payments/observe", { ...observe, network: "arc" });
    expect(solanaHashOnArc.status).toBe(400);
  });

  it("records a verified solana transfer once and dedupes the replay", async () => {
    const app = await appWith({ solana: recordingVerifier() });
    const first = await call(app, "POST", "/v1/payments/observe", observe);
    expect(first.status).toBe(201);
    expect(first.json.data.payment).toMatchObject({ network: "solana", status: "confirmed", txHash: SIG_A });
    const again = await call(app, "POST", "/v1/payments/observe", observe);
    expect(again.status).toBe(200);
    expect(again.json.data.deduped).toBe(true);
  });
});

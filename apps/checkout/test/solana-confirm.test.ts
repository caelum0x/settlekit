/**
 * Checkout confirmation for Solana (and fail-closed behaviour for every
 * network): real store + payments lifecycle + entitlements over in-memory
 * repositories, a canned Solana RPC and a counting fake GitHub client.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryEntitlementRepository } from "@settlekit/entitlements";
import {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  createCheckoutSession,
} from "@settlekit/payments";
import type { GitHubAccessClient } from "@settlekit/github";
import type {
  CheckoutSession,
  Customer,
  DeliveryAction,
  PaymentNetwork,
  Price,
  Product,
} from "@settlekit/common";

import {
  BUYER,
  MERCHANT,
  PAYMENT_SIG,
  REFERENCE,
  USDC,
  fakeRpc,
  sig,
  transferTx,
  type FakeRpcState,
} from "../../../packages/solana/test/fixtures";
import type { CheckoutBackend } from "../lib/backend";
import { entitlementIdForPayment } from "../lib/deliver";
import { CheckoutError } from "../lib/errors";
import type { GitHubDelivery } from "../lib/github-delivery";
import { verifyOnChainPayment } from "../lib/arc";
import type { SolanaRuntimeResult } from "../lib/solana";
import { buildSolanaTransaction, prepareSolanaPayment } from "../lib/solana-checkout";
import {
  confirmFromReference,
  getDeliveredAccess,
  recordAndConfirm,
  type StoreDeps,
} from "../lib/store";

const ORG = "org_test";
const EVM_TX = `0x${"ab".repeat(32)}`;

const product: Product = {
  id: "prod_repo",
  merchantId: "mch_test",
  organizationId: ORG,
  name: "Atlas Starter Kit",
  description: "Private repo",
  type: "github_repo_access",
  status: "active",
  deliveryMode: "github_invite",
  metadata: {},
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const price: Price = {
  id: "price_repo",
  productId: product.id,
  amount: "1",
  currency: "USDC",
  interval: "one_time",
  usageBased: false,
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const action: DeliveryAction = { type: "github_invite", repoId: "acme/atlas", permission: "pull" };

interface Harness {
  deps: StoreDeps;
  payments: InMemoryPaymentRepository;
  checkouts: InMemoryCheckoutRepository;
  entitlements: InMemoryEntitlementRepository;
  invites: Array<{ owner: string; repo: string; username: string }>;
  rpcState: FakeRpcState;
}

function backendOf(
  checkouts: InMemoryCheckoutRepository,
  payments: InMemoryPaymentRepository,
  entitlements: InMemoryEntitlementRepository,
): CheckoutBackend {
  return {
    checkouts,
    payments,
    entitlements,
    persistent: false,
    findProduct: async (id) => (id === product.id ? product : undefined),
    findPrice: async (id) => (id === price.id ? price : undefined),
    merchantName: async () => "Acme Dev Tools",
    deliveryActionForProduct: () => action,
    seededSessionIds: () => [],
  };
}

function fakeGitHub(invites: Harness["invites"], fail = false): GitHubDelivery {
  const client: GitHubAccessClient = {
    async inviteRepoCollaborator(input) {
      if (fail) throw new Error("GitHub 502");
      invites.push({ owner: input.owner, repo: input.repo, username: input.username });
      return { invitationId: 777 };
    },
    async removeRepoCollaborator() {},
    async addTeamMembership() {},
    async removeTeamMembership() {},
    async getRepoCollaboratorPermission() {
      return "read";
    },
  };
  return { ok: true, client, installationId: 42 };
}

function harness(
  options: { solana?: "configured" | "unconfigured"; github?: "ready" | "missing" | "failing" } = {},
): Harness {
  const payments = new InMemoryPaymentRepository();
  const checkouts = new InMemoryCheckoutRepository();
  const entitlements = new InMemoryEntitlementRepository();
  const invites: Harness["invites"] = [];
  const rpcState: FakeRpcState = { transactions: {}, signaturesByAddress: {} };
  const solana: SolanaRuntimeResult =
    options.solana === "unconfigured"
      ? { ok: false, error: "Solana payments are not configured on this checkout (SOLANA_CLUSTER is unset)." }
      : {
          ok: true,
          runtime: {
            config: { cluster: "devnet", rpcUrl: "http://rpc.invalid", usdcMint: USDC, commitment: "confirmed" },
            rpc: fakeRpc(rpcState),
          },
        };
  const githubMode = options.github ?? "ready";
  const github: GitHubDelivery =
    githubMode === "missing"
      ? { ok: false, error: "GitHub App not configured." }
      : fakeGitHub(invites, githubMode === "failing");
  return {
    deps: {
      backend: backendOf(checkouts, payments, entitlements),
      verify: { solana, verifyArc: verifyOnChainPayment },
      fulfillment: { entitlements, github: () => github },
    },
    payments,
    checkouts,
    entitlements,
    invites,
    rpcState,
  };
}

async function openSession(
  h: Harness,
  network: PaymentNetwork = "solana",
  overrides: Partial<CheckoutSession> = {},
): Promise<CheckoutSession> {
  const draft = createCheckoutSession({
    organizationId: ORG,
    merchantId: product.merchantId,
    items: [{ lineItem: { productId: product.id, priceId: price.id, quantity: 1 }, price }],
    payToAddress: network === "solana" ? MERCHANT : "0x9f2A4b6C8d0E2f4A6b8C0d2E4f6A8b0C2d4E6f80",
    network,
  });
  const session: CheckoutSession = {
    ...draft,
    ...(network === "solana" ? { paymentReference: REFERENCE } : {}),
    collectedFields: { email: "buyer@example.com", githubUsername: "octocat" },
    ...overrides,
  };
  return h.checkouts.save(session);
}

/** Put the canned payment tx on chain and index it under the reference. */
function landPayment(h: Harness, signature = PAYMENT_SIG, amount = 1_000_000n): void {
  h.rpcState.transactions = { ...h.rpcState.transactions, [signature]: transferTx({ signature, amount }) };
  h.rpcState.signaturesByAddress = {
    ...h.rpcState.signaturesByAddress,
    [REFERENCE]: [
      { signature, slot: 291_550_123, err: null, memo: null, blockTime: 1_727_600_000, confirmationStatus: "confirmed" },
    ],
  };
}

async function expectCheckoutError(promise: Promise<unknown>, code: CheckoutError["code"]): Promise<CheckoutError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CheckoutError);
  expect((error as CheckoutError).code).toBe(code);
  return error as CheckoutError;
}

describe("recordAndConfirm fails closed", () => {
  let savedEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.ARC_RPC_URL;
    delete process.env.ARC_USDC_ADDRESS;
    return () => {
      process.env = savedEnv;
    };
  });

  it("rejects a Solana payment when no Solana verifier is configured", async () => {
    const h = harness({ solana: "unconfigured" });
    const session = await openSession(h);
    landPayment(h);

    const error = await expectCheckoutError(recordAndConfirm(session.id, PAYMENT_SIG, h.deps), "verification_failed");
    expect(error.message).toMatch(/SOLANA_CLUSTER/);
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
    expect((await h.checkouts.findById(session.id))?.status).toBe("open");
  });

  it.each(["arc", "base", "ethereum"] as const)("rejects a well-formed %s hash with no verifier", async (network) => {
    const h = harness();
    const session = await openSession(h, network);

    await expectCheckoutError(recordAndConfirm(session.id, EVM_TX, h.deps), "verification_failed");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
    expect(h.invites).toHaveLength(0);
  });

  it("rejects a transaction that is not on chain", async () => {
    const h = harness();
    const session = await openSession(h);

    await expectCheckoutError(recordAndConfirm(session.id, PAYMENT_SIG, h.deps), "verification_failed");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
  });

  it("rejects an underpaying transaction", async () => {
    const h = harness();
    const session = await openSession(h);
    landPayment(h, PAYMENT_SIG, 999_999n);

    await expectCheckoutError(recordAndConfirm(session.id, PAYMENT_SIG, h.deps), "verification_failed");
  });

  it("rejects a Solana session without a payment reference", async () => {
    const h = harness();
    const session = await openSession(h, "solana");
    const { paymentReference: _dropped, ...unreferenced } = session;
    await h.checkouts.save(unreferenced);
    landPayment(h);

    const error = await expectCheckoutError(recordAndConfirm(session.id, PAYMENT_SIG, h.deps), "verification_failed");
    expect(error.message).toMatch(/reference/);
  });

  it("rejects hashes malformed for the session's network", async () => {
    const h = harness();
    const solanaSession = await openSession(h);
    await expectCheckoutError(recordAndConfirm(solanaSession.id, EVM_TX, h.deps), "malformed_tx");
    const arcSession = await openSession(h, "arc");
    await expectCheckoutError(recordAndConfirm(arcSession.id, PAYMENT_SIG, h.deps), "malformed_tx");
  });
});

describe("duplicate transactions", () => {
  it("refuses to settle a second checkout with an already-used signature", async () => {
    const h = harness();
    const first = await openSession(h);
    const second = await openSession(h);
    landPayment(h);

    await recordAndConfirm(first.id, PAYMENT_SIG, h.deps);
    const error = await expectCheckoutError(recordAndConfirm(second.id, PAYMENT_SIG, h.deps), "duplicate_tx");
    expect(error.status).toBe(409);
    expect(await h.payments.findByCheckoutSessionId(second.id)).toHaveLength(0);
    expect((await h.checkouts.findById(second.id))?.status).toBe("open");
  });

  it("maps a database unique violation on tx_hash to a duplicate conflict", async () => {
    const h = harness();
    const session = await openSession(h);
    landPayment(h);
    const uniqueViolation = Object.assign(new Error("insert failed"), {
      cause: { code: "23505", constraint: "payments_tx_hash_unique_idx" },
    });
    const racingPayments: InMemoryPaymentRepository = Object.assign(Object.create(h.payments), {
      save: async () => {
        throw uniqueViolation;
      },
    });
    const deps: StoreDeps = { ...h.deps, backend: { ...h.deps.backend, payments: racingPayments } };

    await expectCheckoutError(recordAndConfirm(session.id, PAYMENT_SIG, deps), "duplicate_tx");
    expect(h.invites).toHaveLength(0);
  });

  it("re-confirming the same session with the same signature is idempotent", async () => {
    const h = harness();
    const session = await openSession(h);
    landPayment(h);

    const first = await recordAndConfirm(session.id, PAYMENT_SIG, h.deps);
    const again = await recordAndConfirm(session.id, PAYMENT_SIG, h.deps);
    expect(again.payment.id).toBe(first.payment.id);
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(1);
  });
});

describe("confirmFromReference", () => {
  it("is pending until a transaction carries the reference, then confirms once", async () => {
    const h = harness();
    const session = await openSession(h);

    expect(await confirmFromReference(session.id, h.deps)).toEqual({ status: "pending" });

    landPayment(h);
    const polls = await Promise.all([
      confirmFromReference(session.id, h.deps),
      confirmFromReference(session.id, h.deps),
      confirmFromReference(session.id, h.deps),
    ]);
    const later = await confirmFromReference(session.id, h.deps);

    const ids = new Set(
      [...polls, later].map((result) => (result.status === "paid" ? result.payment.id : "pending")),
    );
    expect(ids.size).toBe(1);
    expect(ids.has("pending")).toBe(false);
    if (later.status !== "paid") throw new Error("expected paid");
    expect(later.payment.status).toBe("confirmed");
    expect(later.payment.txHash).toBe(PAYMENT_SIG);
    expect(later.session.status).toBe("completed");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(1);
  });

  it("fails closed when Solana is not configured", async () => {
    const h = harness({ solana: "unconfigured" });
    const session = await openSession(h);
    await expectCheckoutError(confirmFromReference(session.id, h.deps), "network_not_configured");
  });

  it("does not accept a failed on-chain attempt", async () => {
    const h = harness();
    const session = await openSession(h);
    h.rpcState.signaturesByAddress = {
      [REFERENCE]: [
        { signature: sig(9), slot: 1, err: { InstructionError: [1, "Custom"] }, memo: null, blockTime: null, confirmationStatus: "confirmed" },
      ],
    };
    expect(await confirmFromReference(session.id, h.deps)).toEqual({ status: "pending" });
  });
});

describe("GitHub delivery", () => {
  it("invites the buyer exactly once per confirmed payment and records an active entitlement", async () => {
    const h = harness();
    const session = await openSession(h);
    landPayment(h);

    await confirmFromReference(session.id, h.deps);
    await confirmFromReference(session.id, h.deps);
    const { payment } = await recordAndConfirm(session.id, PAYMENT_SIG, h.deps);

    expect(h.invites).toEqual([{ owner: "acme", repo: "atlas", username: "octocat" }]);
    const entitlement = await h.entitlements.findById(entitlementIdForPayment(payment));
    expect(entitlement).toMatchObject({
      status: "active",
      productId: product.id,
      resourceId: "acme/atlas",
      grantedBy: { type: "payment", id: payment.id },
    });

    const access = await getDeliveredAccess(session.id, h.deps);
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      kind: "github_invite",
      isLink: true,
      value: "https://github.com/acme/atlas/invitations",
    });
    expect(access[0]?.pending).toBeUndefined();
  });

  it("shows pending setup (never a fake invite link) when the GitHub App is not configured", async () => {
    const h = harness({ github: "missing" });
    const session = await openSession(h);
    landPayment(h);

    const result = await confirmFromReference(session.id, h.deps);
    if (result.status !== "paid") throw new Error("expected paid");
    expect(result.payment.status).toBe("confirmed");

    const entitlement = await h.entitlements.findById(entitlementIdForPayment(result.payment));
    expect(entitlement?.status).toBe("pending");

    const access = await getDeliveredAccess(session.id, h.deps);
    expect(access[0]).toMatchObject({ pending: true, isLink: false, value: "Pending setup" });
    expect(JSON.stringify(access)).not.toContain("github.com");
  });

  it("keeps the payment confirmed and access pending when GitHub rejects the invite", async () => {
    const h = harness({ github: "failing" });
    const session = await openSession(h);
    landPayment(h);

    const { payment } = await recordAndConfirm(session.id, PAYMENT_SIG, h.deps);
    expect(payment.status).toBe("confirmed");
    const access = await getDeliveredAccess(session.id, h.deps);
    expect(access[0]).toMatchObject({ pending: true, isLink: false, value: "Invite not sent yet" });
  });
});

describe("Solana Pay request + transaction", () => {
  it("saves buyer fields and returns a transfer request bound to the reference", async () => {
    const h = harness();
    const session = await openSession(h, "solana", { collectedFields: {} });

    const result = await prepareSolanaPayment(
      {
        sessionId: session.id,
        fields: { email: "buyer@example.com", githubUsername: " octocat ", extra: "dropped" },
        origin: "https://checkout.example.com",
      },
      h.deps,
    );

    const url = new URL(result.transferUrl);
    expect(url.protocol).toBe("solana:");
    expect(url.pathname).toBe(MERCHANT);
    expect(url.searchParams.get("amount")).toBe("1");
    expect(url.searchParams.get("spl-token")).toBe(USDC);
    expect(url.searchParams.get("reference")).toBe(REFERENCE);
    expect(result.transactionUrl).toBe(
      `solana:https://checkout.example.com/api/v1/checkout-sessions/${session.id}/solana/tx`,
    );
    expect(result.cluster).toBe("devnet");
    expect((await h.checkouts.findById(session.id))?.collectedFields).toEqual({
      email: "buyer@example.com",
      githubUsername: "octocat",
    });
  });

  it("requires the delivery fields and a configured cluster", async () => {
    const h = harness();
    const session = await openSession(h, "solana", { collectedFields: {} });
    await expectCheckoutError(
      prepareSolanaPayment({ sessionId: session.id, fields: { email: "buyer@example.com" }, origin: "http://localhost:3000" }, h.deps),
      "fields_incomplete",
    );

    const off = harness({ solana: "unconfigured" });
    const offSession = await openSession(off);
    await expectCheckoutError(
      prepareSolanaPayment({ sessionId: offSession.id, fields: {}, origin: "http://localhost:3000" }, off.deps),
      "network_not_configured",
    );
  });

  it("builds an unsigned base64 transaction for the buyer's wallet", async () => {
    const h = harness();
    const session = await openSession(h);

    const tx = await buildSolanaTransaction({ sessionId: session.id, account: BUYER }, h.deps);
    expect(Buffer.from(tx.transaction, "base64").length).toBeGreaterThan(100);
    expect(tx.message).toBe("Acme Dev Tools: Atlas Starter Kit");

    await expectCheckoutError(
      buildSolanaTransaction({ sessionId: session.id, account: "not-a-wallet" }, h.deps),
      "invalid_request",
    );
  });

  it("refuses to build a transaction for a paid session", async () => {
    const h = harness();
    const session = await openSession(h);
    landPayment(h);
    await recordAndConfirm(session.id, PAYMENT_SIG, h.deps);

    await expectCheckoutError(buildSolanaTransaction({ sessionId: session.id, account: BUYER }, h.deps), "session_not_payable");
  });
});

describe("guest checkout customer row", () => {
  it("creates the customer before the payment so the payments.customer_id FK holds", async () => {
    const h = harness();
    const customerRows = new Map<string, Customer>();
    const customers = {
      findById: async (id: string) => customerRows.get(id) ?? null,
      save: async (customer: Customer) => {
        customerRows.set(customer.id, customer);
        return customer;
      },
    };
    const fkPayments = Object.create(h.payments) as InMemoryPaymentRepository;
    fkPayments.save = async (payment) => {
      if (!customerRows.has(payment.customerId)) throw new Error("payments_customer_id_customers_id_fk");
      return h.payments.save(payment);
    };
    const deps: StoreDeps = { ...h.deps, backend: { ...h.deps.backend, payments: fkPayments, customers } };
    const session = await openSession(h);
    landPayment(h);

    const result = await confirmFromReference(session.id, deps);

    expect(result.status).toBe("paid");
    expect(customerRows.get(`cus_${session.id}`)?.organizationId).toBe(ORG);
  });
});

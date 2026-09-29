/**
 * payment-confirm job: verifies each pending payment on ITS network against
 * ITS checkout session's payTo (never the USDC contract), and fails closed for
 * networks the worker cannot verify.
 */
import { describe, expect, it } from "vitest";
import { money, toIso, type CheckoutSession, type Payment, type PaymentNetwork } from "@settlekit/common";
import type { ArcRpc, ArcTransactionReceipt, Hex } from "@settlekit/arc";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import type { EmailTransport } from "@settlekit/notifications";
import { loadConfig } from "../src/config.js";
import { buildJobContext } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";
import { paymentConfirmJob } from "../src/jobs/payment-confirm-job.js";

const BASE_ENV: Record<string, string> = {
  ARC_RPC_URL: "http://localhost:8545",
  ARC_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_CHAIN_ID: "5042002",
  ARC_MIN_CONFIRMATIONS: "2",
  RESEND_API_KEY: "re_test_key",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  GITHUB_INSTALLATION_ID: "9999",
  DISCORD_BOT_TOKEN: "bot.token.value",
  FILE_DELIVERY_BASE_URL: "https://dl.settlekit.dev/download",
  FILE_DELIVERY_SECRET: "file-secret-value",
  LICENSE_TOKEN_SECRET: "license-token-secret",
  WEBHOOK_SIGNING_SECRET: "wh-signing-secret",
};

const USDC_CONTRACT = BASE_ENV.ARC_USDC_ADDRESS as Hex;
const ARC_MERCHANT = "0x3333333333333333333333333333333333333333" as Hex;
const ARC_BUYER = "0x2222222222222222222222222222222222222222" as Hex;
const ARC_TX = `0x${"cd".repeat(32)}` as Hex;

const SOL_MERCHANT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const SOL_SIG =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

const noopEmail: EmailTransport = { send: async () => ({ id: "email_1" }) };

/** Arc receipt: `amountBase` USDC from the buyer to `recipient`. */
function arcRpcPaying(recipient: Hex, amountBase: bigint): ArcRpc {
  const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").padStart(64, "0")}` as Hex;
  const receipt: ArcTransactionReceipt = {
    transactionHash: ARC_TX,
    blockNumber: 100n,
    status: "success",
    from: ARC_BUYER,
    to: USDC_CONTRACT,
    logs: [
      {
        address: USDC_CONTRACT,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex,
          pad(ARC_BUYER),
          pad(recipient),
        ],
        data: pad(amountBase.toString(16)),
        logIndex: 0,
      },
    ],
  };
  return {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 105n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
  };
}

function setup(options: { env?: Record<string, string>; arcRpc?: ArcRpc } = {}) {
  const stores = new InMemoryWorkerStore();
  const { ctx } = buildJobContext({
    config: loadConfig({ ...BASE_ENV, ...(options.env ?? {}) }),
    githubApi: {} as GitHubApi,
    discordApi: {} as DiscordApi,
    emailTransport: noopEmail,
    stores,
    arcRpc: options.arcRpc ?? arcRpcPaying(ARC_MERCHANT, 10_000_000n),
  });
  return { ctx, stores };
}

async function seed(
  stores: InMemoryWorkerStore,
  network: PaymentNetwork,
  payTo: string,
  txHash: string,
  extra: Partial<CheckoutSession> = {},
): Promise<Payment> {
  const now = new Date();
  await stores.upsertCheckoutSession({
    id: `cs_${network}`,
    organizationId: "org_1",
    merchantId: "mch_1",
    lineItems: [],
    amount: money("10", "USDC"),
    status: "open",
    payToAddress: payTo,
    network,
    expiresAt: toIso(new Date(now.getTime() + 86_400_000)),
    collectedFields: {},
    createdAt: toIso(now),
    ...extra,
  });
  return stores.upsertPayment({
    id: `pay_${network}`,
    organizationId: "org_1",
    checkoutSessionId: `cs_${network}`,
    customerId: "cus_1",
    amount: money("10", "USDC"),
    network,
    txHash,
    confirmations: 0,
    status: "pending",
    createdAt: toIso(now),
  });
}

describe("paymentConfirmJob", () => {
  it("confirms an Arc payment that paid the session's payTo", async () => {
    const { ctx, stores } = setup();
    await seed(stores, "arc", ARC_MERCHANT, ARC_TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect((await stores.getPayment("pay_arc"))?.status).toBe("confirmed");
  });

  it("does NOT confirm an Arc transfer to the USDC contract (old bug) instead of the merchant", async () => {
    const { ctx, stores } = setup({ arcRpc: arcRpcPaying(USDC_CONTRACT, 10_000_000n) });
    await seed(stores, "arc", ARC_MERCHANT, ARC_TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.getPayment("pay_arc"))?.status).toBe("pending");
  });

  it("leaves a payment pending when its checkout session is missing", async () => {
    const { ctx, stores } = setup();
    await stores.upsertPayment({
      id: "pay_orphan",
      organizationId: "org_1",
      checkoutSessionId: "cs_missing",
      customerId: "cus_1",
      amount: money("10", "USDC"),
      network: "arc",
      txHash: ARC_TX,
      confirmations: 0,
      status: "pending",
      createdAt: toIso(new Date()),
    });
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.getPayment("pay_orphan"))?.status).toBe("pending");
  });

  it("fails closed for Base: no worker verifier, payment stays pending", async () => {
    const { ctx, stores } = setup();
    await seed(stores, "base", ARC_MERCHANT, ARC_TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.getPayment("pay_base"))?.status).toBe("pending");
  });

  it("fails closed for a legacy solana row: unsupported network, payment stays pending", async () => {
    // Solana is not supported on this build; even with SOLANA_* env set, a
    // stored solana payment can never be confirmed by the worker.
    const { ctx, stores } = setup({ env: { SOLANA_CLUSTER: "mainnet" } });
    await seed(stores, "solana" as PaymentNetwork, SOL_MERCHANT, SOL_SIG);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.getPayment("pay_solana"))?.status).toBe("pending");
  });
});

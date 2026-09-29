/**
 * Real Solana devnet purchase through the hosted checkout, end to end:
 *
 *   session -> pay-url (buyer fields) -> server-built tx -> buyer signs + sends
 *   on devnet -> status polling confirms by reference -> receipt + access.
 *
 * Nothing is mocked: the checkout must run with SOLANA_CLUSTER=devnet and the
 * buyer wallet needs devnet SOL (fees) and devnet USDC
 * (https://faucet.circle.com, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU).
 *
 * Run (Node >= 22.6 strips the types):
 *   node scripts/solana-devnet-e2e.ts
 *
 * Env:
 *   CHECKOUT_URL              checkout base URL, e.g. http://localhost:3001 (required)
 *   SOLANA_BUYER_KEYPAIR      path to a solana-keygen JSON keypair (required)
 *   SOLANA_RPC_URL            devnet RPC (default https://api.devnet.solana.com)
 *   BUYER_EMAIL               default e2e@settlekit.dev
 *   BUYER_GITHUB_USERNAME     for GitHub products (optional)
 *   CHECKOUT_SESSION_ID       pay an existing Solana session, or create one via the API:
 *     SETTLEKIT_API_URL, SETTLEKIT_API_KEY, SETTLEKIT_MERCHANT_ID,
 *     SETTLEKIT_PRICE_ID, SETTLEKIT_PRODUCT_ID, SOLANA_PAY_TO
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// @solana/kit is a dependency of packages/solana; resolve it from there so the
// script needs no root-level install.
const requireFromSolana = createRequire(new URL("../packages/solana/package.json", import.meta.url));
const kit = requireFromSolana("@solana/kit") as typeof import("@solana/kit");

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function createSession(): Promise<string> {
  const api = env("SETTLEKIT_API_URL").replace(/\/$/, "");
  const productId = env("SETTLEKIT_PRODUCT_ID");
  const body = {
    merchantId: env("SETTLEKIT_MERCHANT_ID"),
    items: [{ priceId: env("SETTLEKIT_PRICE_ID"), productId, quantity: 1 }],
    payToAddress: env("SOLANA_PAY_TO"),
    network: "solana",
  };
  const created = await json<{ data: { id: string; paymentReference?: string } }>(`${api}/v1/checkout-sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("SETTLEKIT_API_KEY")}` },
    body: JSON.stringify(body),
  });
  if (!created.data.paymentReference) throw new Error("API created a Solana session without a paymentReference");
  return created.data.id;
}

async function main(): Promise<void> {
  const checkout = env("CHECKOUT_URL").replace(/\/$/, "");
  const rpc = kit.createSolanaRpc(env("SOLANA_RPC_URL", "https://api.devnet.solana.com"));
  const secret = Uint8Array.from(JSON.parse(readFileSync(env("SOLANA_BUYER_KEYPAIR"), "utf8")) as number[]);
  const buyer = await kit.createKeyPairSignerFromBytes(secret);
  console.log(`buyer        ${buyer.address}`);

  const sessionId = process.env.CHECKOUT_SESSION_ID?.trim() || (await createSession());
  const base = `${checkout}/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}`;
  console.log(`session      ${sessionId}`);

  const fields: Record<string, string> = {
    email: env("BUYER_EMAIL", "e2e@settlekit.dev"),
    ...(process.env.BUYER_GITHUB_USERNAME ? { githubUsername: process.env.BUYER_GITHUB_USERNAME } : {}),
  };
  const payUrl = await json<{ transferUrl: string; reference: string; cluster: string }>(`${base}/solana/pay-url`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  if (payUrl.cluster !== "devnet") throw new Error(`checkout is on ${payUrl.cluster}; this script only pays devnet`);
  console.log(`reference    ${payUrl.reference}`);
  console.log(`solana pay   ${payUrl.transferUrl}`);

  const { transaction } = await json<{ transaction: string }>(`${base}/solana/tx`, {
    method: "POST",
    body: JSON.stringify({ account: buyer.address }),
  });
  const unsigned = kit.getTransactionDecoder().decode(kit.getBase64Encoder().encode(transaction));
  const signed = await kit.signTransaction([buyer.keyPair], unsigned);
  const signature = kit.getSignatureFromTransaction(signed);
  await rpc
    .sendTransaction(kit.getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
    .send();
  console.log(`sent         ${signature}`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const status = await json<{ status: string; txHash?: string; explorerUrl?: string }>(`${base}/solana/status`);
    if (status.status === "paid") {
      if (status.txHash !== signature) throw new Error(`confirmed ${status.txHash}, expected ${signature}`);
      console.log(`confirmed    ${status.explorerUrl}`);
      break;
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for the checkout to confirm the payment");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const receipt = await json<{ paymentId: string; access: Array<{ title: string; value: string; pending?: boolean }> }>(
    `${base}/receipt`,
  );
  console.log(`payment      ${receipt.paymentId}`);
  for (const item of receipt.access) {
    console.log(`access       ${item.title}: ${item.pending ? `PENDING (${item.value})` : item.value}`);
  }
  if (receipt.access.length === 0) throw new Error("receipt has no delivered access");
  console.log("devnet e2e purchase OK");
}

main().catch((error: unknown) => {
  console.error(`devnet e2e FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

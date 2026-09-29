/**
 * Agent buys over x402 on Solana (SOLANA-PLAN section D): builds a
 * partially-signed SPL USDC transfer with the x402-foundation SVM client;
 * PayAI co-signs as fee payer and submits; SettleKit records the payment,
 * grants the entitlement and returns the delivered artifact.
 *
 *   AGENT_SOLANA_SECRET_KEY='[12,34,...]' PRODUCT_ID=prod_... \
 *     pnpm --filter @settlekit/examples agent-buy-solana
 *
 * AGENT_SOLANA_SECRET_KEY: the 64-byte keypair as a JSON array (solana-keygen
 * file contents) or base58. SOLANA_RPC_URL overrides the public RPC.
 * SETTLEKIT_CHAIN_ENV=testnet pays on devnet.
 */
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { createSpecX402Fetch, readPaymentResponse, resolveX402Network } from "@settlekit/x402-client";
import { agentTarget, report, requireEnv } from "./support/agent-env.js";

function secretKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : Uint8Array.from(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) throw new Error("AGENT_SOLANA_SECRET_KEY must be a 64-byte Solana keypair");
  return bytes;
}

export async function main(): Promise<unknown> {
  const signer = await createKeyPairSignerFromBytes(secretKeyBytes(requireEnv("AGENT_SOLANA_SECRET_KEY")));
  const target = agentTarget("x402");
  const network = resolveX402Network("solana", target.env);
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  const pay = createSpecX402Fetch({
    svmSigner: signer,
    ...(rpcUrl ? { svmRpcUrl: rpcUrl } : {}),
    env: target.env,
    preferNetworks: [network],
    maxAtomicPerPayment: target.maxAtomicPerPayment,
  });
  process.stdout.write(`agent ${signer.address} paying on ${network} -> ${target.url}\n`);
  const response = await pay(target.url, target.init);
  return report(response, readPaymentResponse(response));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

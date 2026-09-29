/**
 * Agent buys on Tempo over the Machine Payments Protocol with the mppx
 * client (wevm, MIT): the 402 `WWW-Authenticate: Payment` challenge is paid
 * with a TIP-20 transfer (USDC.e on mainnet, pathUSD on Moderato) and retried
 * with `Authorization: Payment ...`; SettleKit verifies it on-chain, records
 * the payment and returns the artifact with a `Payment-Receipt`.
 *
 *   AGENT_TEMPO_PRIVATE_KEY=0x... PRODUCT_ID=prod_... \
 *     pnpm --filter @settlekit/examples agent-buy-tempo
 *
 * The account pays Tempo fees in a USD stablecoin, so it needs the charged
 * token plus a little fee-token balance.
 */
import { privateKeyToAccount } from "viem/accounts";
import { Receipt } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { agentTarget, report, requireEnv } from "./support/agent-env.js";

export async function main(): Promise<unknown> {
  const account = privateKeyToAccount(requireEnv("AGENT_TEMPO_PRIVATE_KEY") as `0x${string}`);
  const target = agentTarget("mpp");
  const mppx = Mppx.create({
    methods: [tempo({ account })],
    polyfill: false,
    // Spend guard: refuse any challenge above AGENT_MAX_USD before signing.
    onChallenge: async (challenge, { createCredential }) => {
      const amount = BigInt(String((challenge.request as { amount?: unknown }).amount ?? "0"));
      if (amount > BigInt(target.maxAtomicPerPayment)) {
        throw new Error(`challenge asks ${amount} base units, above AGENT_MAX_USD (${target.maxAtomicPerPayment})`);
      }
      return createCredential();
    },
  });
  process.stdout.write(`agent ${account.address} paying over MPP on Tempo (${target.env}) -> ${target.url}\n`);
  const response = await mppx.fetch(target.url, target.init);
  let receipt: unknown = null;
  try {
    receipt = Receipt.fromResponse(response.clone());
  } catch {
    receipt = null;
  }
  return report(response, receipt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

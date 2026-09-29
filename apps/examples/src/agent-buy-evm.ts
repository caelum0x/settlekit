/**
 * Agent buys over x402 on an EVM chain: signs an EIP-3009 (or Permit2)
 * authorization with the x402-foundation client; the SettleKit API settles
 * it (PayAI for Base/Arbitrum, the self-hosted facilitator for Ethereum,
 * HyperEVM and Robinhood) BEFORE delivering, then returns the artifact.
 *
 *   AGENT_EVM_PRIVATE_KEY=0x... PRODUCT_ID=prod_... \
 *     pnpm --filter @settlekit/examples agent-buy-evm hyperevm
 *
 * Network argument: base | arbitrum | ethereum | hyperevm | robinhood | tempo
 * (or a CAIP-2 id). Needs the token on that chain (USDC; USDG on Robinhood).
 * Permit2 networks (Tempo, Robinhood testnet) need a one-time Permit2 approval.
 */
import { privateKeyToAccount } from "viem/accounts";
import { createSpecX402Fetch, readPaymentResponse, resolveX402Network } from "@settlekit/x402-client";
import { agentTarget, report, requireEnv } from "./support/agent-env.js";

export async function main(networkArg = process.argv[2] ?? "base"): Promise<unknown> {
  const account = privateKeyToAccount(requireEnv("AGENT_EVM_PRIVATE_KEY") as `0x${string}`);
  const target = agentTarget("x402");
  const network = resolveX402Network(networkArg, target.env);
  if (!network.startsWith("eip155:")) throw new Error(`${networkArg} is not an EVM network; use agent-buy-solana`);
  const pay = createSpecX402Fetch({
    evmSigner: account,
    env: target.env,
    preferNetworks: [network],
    maxAtomicPerPayment: target.maxAtomicPerPayment,
  });
  process.stdout.write(`agent ${account.address} paying on ${network} -> ${target.url}\n`);
  const response = await pay(target.url, target.init);
  return report(response, readPaymentResponse(response));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

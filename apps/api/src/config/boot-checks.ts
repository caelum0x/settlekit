/**
 * Boot-time chain-id assertion: every enabled EVM chain's RPC must serve the
 * chain the registry says it does. A mismatch refuses to boot (a mis-pointed
 * RPC could otherwise confirm payments made on another chain). An unreachable
 * RPC only warns: each verifier re-asserts the chain id before it verifies,
 * so payments on that chain fail closed until the RPC answers correctly.
 */
import { checkEvmChainIds, type EvmVerifier } from "@settlekit/chains";

export type BootLog = (message: string, fields: Record<string, unknown>) => void;

export async function assertChainIdsAtBoot(verifiers: readonly EvmVerifier[], log: BootLog): Promise<void> {
  const results = await checkEvmChainIds(verifiers);
  const mismatched = results.filter((result) => result.mismatch);
  if (mismatched.length > 0) {
    throw new Error(
      `Refusing to boot: RPC chain id mismatch for ${mismatched.map((r) => `${r.key} (${r.error ?? "mismatch"})`).join(", ")}`,
    );
  }
  for (const result of results) {
    if (!result.ok) log("evm rpc unreachable at boot; chain fails closed until it answers", { chain: result.key, error: result.error });
  }
  log("evm chains verified", { chains: results.filter((r) => r.ok).map((r) => r.key) });
}

/**
 * Machine Payments Protocol (MPP) runtime for Tempo, via `mppx` (wevm, MIT).
 *
 * The agent pays a TIP-20 transfer on Tempo (USDC.e on mainnet, pathUSD on
 * Moderato) and presents the credential in `Authorization: Payment ...`;
 * mppx verifies the transfer on-chain (amount, currency, recipient, memo
 * binding, success, replay) and returns a receipt whose `reference` is the
 * transaction hash.
 *
 *   MPP_SECRET_KEY        >= 32 bytes; binds challenges (required to enable)
 *   MPP_TEMPO_RECIPIENT   merchant address (falls back to X402_PAY_TO_TEMPO / X402_EVM_PAY_TO)
 *   MPP_REALM             challenge realm (default "settlekit")
 *   TEMPO_NETWORK / SETTLEKIT_CHAIN_ENV  mainnet (USDC.e) | testnet (Moderato pathUSD)
 */
import { checkPayTo, getEvmChain, parseChainEnv, readEnv, type ChainEnv, type Env } from "@settlekit/chains";
import type { Method } from "mppx";
import { tempo } from "mppx/server";

export interface MppRuntime {
  secretKey: string;
  realm: string;
  env: ChainEnv;
  chainId: number;
  /** TIP-20 token address the charge is denominated in. */
  currency: string;
  symbol: string;
  decimals: number;
  recipient: string;
  /** The server charge method (real `tempo.charge` in production; injectable). */
  charge: Method.AnyServer;
}

const MIN_SECRET_BYTES = 32;

/** Build the MPP runtime from env, or null (with a note) when not configured. */
export function buildMppRuntime(env: Env, notes: string[]): MppRuntime | null {
  const secretKey = readEnv(env, "MPP_SECRET_KEY");
  if (secretKey === undefined) return null;
  if (Buffer.byteLength(secretKey) < MIN_SECRET_BYTES) {
    notes.push(`mpp: MPP_SECRET_KEY must be at least ${MIN_SECRET_BYTES} bytes`);
    return null;
  }
  const chainEnv =
    parseChainEnv(readEnv(env, "TEMPO_NETWORK"), "TEMPO_NETWORK") ??
    parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV") ??
    "testnet";
  const spec = getEvmChain("tempo", chainEnv);
  if (!spec) {
    notes.push(`mpp: no Tempo chain for ${chainEnv}`);
    return null;
  }
  const recipient =
    readEnv(env, "MPP_TEMPO_RECIPIENT") ?? readEnv(env, "X402_PAY_TO_TEMPO") ?? readEnv(env, "X402_EVM_PAY_TO");
  if (recipient === undefined || !checkPayTo("tempo", recipient).ok) {
    notes.push("mpp: set a valid MPP_TEMPO_RECIPIENT");
    return null;
  }
  const charge = tempo.charge({
    currency: spec.token.address,
    decimals: spec.token.decimals,
    recipient: recipient as `0x${string}`,
    testnet: chainEnv === "testnet",
  });
  return {
    secretKey,
    realm: readEnv(env, "MPP_REALM") ?? "settlekit",
    env: chainEnv,
    chainId: spec.chainId,
    currency: spec.token.address,
    symbol: spec.token.symbol,
    decimals: spec.token.decimals,
    recipient,
    charge: charge as unknown as Method.AnyServer,
  };
}

/**
 * Which networks a buyer can actually pay a session on, right now.
 *
 * A network is offered only when ALL hold: the merchant accepted it on the
 * session, this checkout has a verifier for it (fail closed), and the
 * session's payTo for it is a valid destination on that network. The
 * seeded demo address is additionally refused on EVM mainnets, so a demo
 * session can never ask for real funds to a placeholder.
 */
import { checkPayTo, isEvmNetwork } from "@settlekit/chains";
import type { CheckoutSession, PaymentNetwork } from "@settlekit/common";

import { legacyArcConfigured } from "./arc";
import { evmUnavailableReason } from "./evm";
import { describeNetwork, type ChainEnvName, type NetworkLabel } from "./format";
import { DEMO_EVM_PAY_TO } from "./seed";
import type { VerifyDeps } from "./verify-payment";
import { payToFor } from "./verify-payment";

/** A network option for the picker (server-computed, serializable). */
export interface NetworkOption extends NetworkLabel {
  env: ChainEnvName;
  available: boolean;
  /** Why the network cannot be used here (when unavailable). */
  unavailableReason?: string;
}

/** Networks the merchant accepts on this session (defaults to the session network). */
export function acceptedNetworksOf(session: CheckoutSession): PaymentNetwork[] {
  const accepted = session.acceptedNetworks ?? [session.network];
  return accepted.includes(session.network) ? accepted : [session.network, ...accepted];
}

/** The environment `network` settles on in this deployment. */
export function networkEnv(network: PaymentNetwork, verify: VerifyDeps): ChainEnvName {
  if (network === "solana") return verify.solana.ok && verify.solana.runtime.config.cluster === "devnet" ? "testnet" : "mainnet";
  if (network === "zcash") return "mainnet";
  if (verify.evm?.ok && isEvmNetwork(network)) {
    const chain = verify.evm.runtime.config.enabled[network];
    if (chain !== undefined) return chain.spec.env;
    return verify.evm.runtime.config.env;
  }
  return "mainnet";
}

function configReason(network: PaymentNetwork, verify: VerifyDeps): string | undefined {
  if (network === "solana") return verify.solana.ok ? undefined : verify.solana.error;
  if (network === "zcash") {
    if (verify.zcash === undefined) return "Zcash payments are not enabled on this checkout.";
    return verify.zcash.ok ? undefined : verify.zcash.error;
  }
  const reason = evmUnavailableReason(verify.evm, network);
  // Legacy Arc settings still verify pasted hashes (see ./arc).
  if (reason !== undefined && network === "arc" && legacyArcConfigured()) return undefined;
  return reason;
}

/** Why `network` cannot be paid on `session` (undefined when it can). */
export function networkUnavailableReason(
  session: CheckoutSession,
  network: PaymentNetwork,
  verify: VerifyDeps,
): string | undefined {
  if (!acceptedNetworksOf(session).includes(network)) return `The merchant does not accept ${network} on this checkout.`;
  const configured = configReason(network, verify);
  if (configured !== undefined) return configured;
  const payTo = payToFor(session, network);
  const check = checkPayTo(network, payTo);
  if (!check.ok) return `The merchant has no valid ${network} payment address (${check.reason}).`;
  if (isEvmNetwork(network) && payTo === DEMO_EVM_PAY_TO && networkEnv(network, verify) === "mainnet") {
    return "The demo address is only used on test networks.";
  }
  return undefined;
}

/** Every accepted network with its labels and availability. */
export function buildNetworkOptions(session: CheckoutSession, verify: VerifyDeps): NetworkOption[] {
  return acceptedNetworksOf(session).map((network) => {
    const env = networkEnv(network, verify);
    const reason = networkUnavailableReason(session, network, verify);
    return {
      ...describeNetwork(network, env),
      env,
      available: reason === undefined,
      ...(reason !== undefined ? { unavailableReason: reason } : {}),
    };
  });
}

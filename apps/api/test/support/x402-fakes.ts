/**
 * Fakes for the agent-payment routes: a scripted x402 facilitator (records
 * every verify/settle call and returns deterministic transactions) and a
 * runtime builder pointing the routes at it. Everything else is real: the
 * x402 resource server, route matching, requirement building, header
 * encoding, payment recording, entitlements and delivery.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { SOLANA_CAIP2, getEvmChain } from "@settlekit/chains";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import { USDC_MINT_MAINNET } from "@settlekit/solana";
import { routeFacilitators } from "@settlekit/x402";
import type { AgentPaymentNetwork, AgentPaymentsRuntime } from "../../src/agent-payments/config.js";

export const EVM_MERCHANT = "0x1111111111111111111111111111111111111111";
export const SOL_MERCHANT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
export const SOL_FEE_PAYER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
export const SOLANA_SIG =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

export interface FakeFacilitator extends FacilitatorClient {
  calls: Array<{ op: "verify" | "settle"; network: string; amount: string }>;
  /** Next settle outcome: a fixed tx hash (to force duplicates) or a failure. */
  script: { tx?: string; fail?: string };
}

let counter = 0;

function nextEvmTx(): string {
  counter += 1;
  return `0x${counter.toString(16).padStart(64, "0")}`;
}

function payerOf(payload: PaymentPayload): string | undefined {
  const auth = payload.payload.authorization as { from?: string } | undefined;
  return auth?.from;
}

/** A facilitator that accepts well-formed payloads for its networks. */
export function fakeFacilitator(networks: readonly string[], extra: Record<string, unknown> = {}): FakeFacilitator {
  const fake: FakeFacilitator = {
    calls: [],
    script: {},
    async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
      fake.calls.push({ op: "verify", network: requirements.network, amount: requirements.amount });
      const ok = payload.accepted.amount === requirements.amount && payload.accepted.payTo === requirements.payTo;
      return ok ? { isValid: true, ...(payerOf(payload) ? { payer: payerOf(payload) } : {}) } : { isValid: false, invalidReason: "mismatch" };
    },
    async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
      fake.calls.push({ op: "settle", network: requirements.network, amount: requirements.amount });
      if (fake.script.fail) {
        return { success: false, errorReason: fake.script.fail, transaction: "", network: requirements.network };
      }
      const solana = requirements.network.startsWith("solana:");
      const transaction = fake.script.tx ?? (solana ? SOLANA_SIG : nextEvmTx());
      const payer = payerOf(payload);
      return { success: true, transaction, network: requirements.network, ...(payer ? { payer } : {}) };
    },
    async getSupported() {
      return {
        kinds: networks.map((network) => ({
          x402Version: 2,
          scheme: "exact",
          network: network as Network,
          ...(network.startsWith("solana:") ? { extra: { feePayer: SOL_FEE_PAYER, ...extra } } : {}),
        })),
        extensions: [],
        signers: {},
      };
    },
  };
  return fake;
}

function evmNetwork(key: "base" | "hyperevm" | "robinhood", name: string, version: string, facilitator: "remote" | "local"): AgentPaymentNetwork {
  const spec = getEvmChain(key, "mainnet");
  if (!spec) throw new Error(`missing registry entry for ${key}`);
  return {
    network: key,
    caip2: spec.caip2,
    env: "mainnet",
    symbol: spec.token.symbol,
    asset: spec.token.address,
    decimals: 6,
    payTo: EVM_MERCHANT,
    facilitator,
    extra: { name, version },
    experimental: false,
  };
}

export interface FakeRuntime {
  runtime: AgentPaymentsRuntime;
  remote: FakeFacilitator;
  local: FakeFacilitator;
}

/** Solana + Base via the "remote" fake, HyperEVM + Robinhood via the "local" fake. */
export function fakeRuntime(): FakeRuntime {
  const networks: AgentPaymentNetwork[] = [
    {
      network: "solana",
      caip2: SOLANA_CAIP2.mainnet as Network,
      env: "mainnet",
      symbol: "USDC",
      asset: USDC_MINT_MAINNET,
      decimals: 6,
      payTo: SOL_MERCHANT,
      facilitator: "remote",
      extra: {},
      experimental: false,
    },
    evmNetwork("base", "USD Coin", "2", "remote"),
    evmNetwork("hyperevm", "USDC", "2", "local"),
    evmNetwork("robinhood", "Global Dollar", "1", "local"),
  ];
  const remoteNets = networks.filter((n) => n.facilitator === "remote").map((n) => n.caip2);
  const localNets = networks.filter((n) => n.facilitator === "local").map((n) => n.caip2);
  const remote = fakeFacilitator(remoteNets);
  const local = fakeFacilitator(localNets);
  return {
    remote,
    local,
    runtime: {
      networks,
      facilitators: routeFacilitators([
        { name: "payai", client: remote, networks: remoteNets },
        { name: "local", client: local, networks: localNets },
      ]),
      localFacilitator: null,
      researchPrice: "0.01",
      organizationId: DEFAULT_ORG_ID,
      maxTimeoutSeconds: 300,
      notes: [],
      mpp: null,
    },
  };
}

import { describe, expect, it } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  FacilitatorRoutingError,
  PAYAI_FACILITATOR_URL,
  routeFacilitators,
} from "../src/index.js";

const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE = "eip155:8453";
const HYPEREVM = "eip155:999";

function fakeClient(networks: string[], calls: string[]): FacilitatorClient {
  return {
    async verify(_payload, requirements) {
      calls.push(`verify:${requirements.network}`);
      return { isValid: true };
    },
    async settle(_payload, requirements) {
      calls.push(`settle:${requirements.network}`);
      return { success: true, transaction: "0xabc", network: requirements.network };
    },
    async getSupported() {
      return {
        kinds: networks.map((network) => ({ x402Version: 2, scheme: "exact", network: network as `${string}:${string}` })),
        extensions: [],
        signers: {},
      };
    },
  };
}

function requirements(network: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: network as `${string}:${string}`,
    asset: "0x0",
    amount: "1",
    payTo: "0x1",
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

const payload = { x402Version: 2, accepted: requirements(BASE), payload: {} } as PaymentPayload;

describe("routeFacilitators", () => {
  it("scopes each client's /supported to its routed networks", async () => {
    const calls: string[] = [];
    // PayAI also lists HyperEVM here; the route must not let it serve it.
    const [payai, local] = routeFacilitators([
      { name: "payai", client: fakeClient([SOLANA, BASE, HYPEREVM], calls), networks: [SOLANA, BASE] },
      { name: "local", client: fakeClient([HYPEREVM], calls), networks: [HYPEREVM] },
    ]);
    expect((await payai?.getSupported())?.kinds.map((kind) => kind.network)).toEqual([SOLANA, BASE]);
    expect((await local?.getSupported())?.kinds.map((kind) => kind.network)).toEqual([HYPEREVM]);
  });

  it("forwards verify/settle for routed networks and fails closed otherwise", async () => {
    const calls: string[] = [];
    const [payai] = routeFacilitators([
      { name: "payai", client: fakeClient([BASE], calls), networks: [BASE] },
    ]);
    expect(await payai?.verify(payload, requirements(BASE))).toEqual({ isValid: true });
    expect((await payai?.settle(payload, requirements(BASE)))?.success).toBe(true);
    await expect(payai?.settle(payload, requirements(HYPEREVM))).rejects.toThrow(FacilitatorRoutingError);
    expect(calls).toEqual([`verify:${BASE}`, `settle:${BASE}`]);
  });

  it("refuses a network claimed by two facilitators and drops empty routes", () => {
    expect(() =>
      routeFacilitators([
        { name: "payai", client: fakeClient([], []), networks: [BASE] },
        { name: "local", client: fakeClient([], []), networks: [BASE] },
      ]),
    ).toThrow(/routed to both/);
    expect(routeFacilitators([{ name: "empty", client: fakeClient([], []), networks: [] }])).toHaveLength(0);
  });

  it("points at PayAI's public facilitator", () => {
    expect(PAYAI_FACILITATOR_URL).toBe("https://facilitator.payai.network");
  });
});

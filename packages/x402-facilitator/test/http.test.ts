import { describe, expect, it } from "vitest";
import {
  GasGuard,
  createFacilitatorHttpHandler,
  createSettleKitFacilitator,
  getFacilitatorAsset,
  loadFacilitatorFromEnv,
  type FacilitatorAsset,
} from "../src/index.js";
import { TX_HASH, fakeChain, fakeGas, requirementsFor, signPayment } from "./fixtures.js";

const HYPEREVM = getFacilitatorAsset("hyperevm", "mainnet") as FacilitatorAsset;
const TOKEN = "facilitator-test-token";

function handler() {
  const fake = fakeChain({ asset: HYPEREVM });
  const facilitator = createSettleKitFacilitator({
    env: "mainnet",
    enabledNetworks: ["hyperevm"],
    signerFor: () => fake.signer,
    gasGuard: new GasGuard(fakeGas(), { networks: { "eip155:999": { maxFeePerSettlement: 10n ** 16n } } }),
    maxAmountPerSettlement: 100_000_000n,
    allowedPayTo: "any",
  });
  return { handle: createFacilitatorHttpHandler(facilitator, { authToken: TOKEN, basePath: "/facilitator" }), fake };
}

const url = (path: string) => `http://localhost/facilitator${path}`;

describe("facilitator HTTP handler", () => {
  it("serves /supported and /assets publicly", async () => {
    const { handle } = handler();
    const supported = await handle(new Request(url("/supported")));
    expect(supported.status).toBe(200);
    expect((await supported.json()).kinds).toHaveLength(1);
    const assets = await (await handle(new Request(url("/assets")))).json();
    expect(assets.assets[0]).toMatchObject({ network: "hyperevm", symbol: "USDC", transferMethod: "eip3009" });
  });

  it("requires the bearer token for /verify and /settle", async () => {
    const { handle, fake } = handler();
    const requirements = requirementsFor(HYPEREVM, "1000000");
    const body = JSON.stringify({ x402Version: 2, paymentPayload: await signPayment(requirements), paymentRequirements: requirements });
    const denied = await handle(new Request(url("/settle"), { method: "POST", body }));
    expect(denied.status).toBe(401);
    expect(fake.writes).toHaveLength(0);

    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const verified = await (await handle(new Request(url("/verify"), { method: "POST", body, headers }))).json();
    expect(verified.isValid).toBe(true);
    const settled = await (await handle(new Request(url("/settle"), { method: "POST", body, headers }))).json();
    expect(settled).toMatchObject({ success: true, transaction: TX_HASH });
  });

  it("rejects malformed bodies with 400", async () => {
    const { handle } = handler();
    const headers = { authorization: `Bearer ${TOKEN}` };
    const res = await handle(new Request(url("/verify"), { method: "POST", body: "{}", headers }));
    expect(res.status).toBe(400);
    const notJson = await handle(new Request(url("/verify"), { method: "POST", body: "nope", headers }));
    expect(notJson.status).toBe(400);
  });
});

describe("loadFacilitatorFromEnv", () => {
  const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  it("is off without a relayer key", () => {
    expect(loadFacilitatorFromEnv({})).toBeNull();
  });

  it("enables the default networks and skips experimental or unbudgeted ones with a reason", () => {
    const loaded = loadFacilitatorFromEnv({
      X402_RELAYER_PRIVATE_KEY: key,
      SETTLEKIT_CHAIN_ENV: "mainnet",
      X402_FACILITATOR_NETWORKS: "ethereum,hyperevm,robinhood,tempo",
    });
    expect(loaded?.facilitator.assets().map((asset) => asset.network)).toEqual(["ethereum", "hyperevm", "robinhood"]);
    expect(loaded?.skipped.join("\n")).toMatch(/tempo: experimental/);

    const withTempo = loadFacilitatorFromEnv({
      X402_RELAYER_PRIVATE_KEY: key,
      SETTLEKIT_CHAIN_ENV: "mainnet",
      X402_FACILITATOR_NETWORKS: "tempo",
      X402_FACILITATOR_ALLOW_EXPERIMENTAL: "1",
    });
    expect(withTempo?.skipped.join("\n")).toMatch(/X402_GAS_MAX_FEE_TEMPO/);
  });

  it("supports mixed mainnet/testnet networks and a runtime kill switch", async () => {
    const env: Record<string, string> = {
      X402_RELAYER_PRIVATE_KEY: key,
      SETTLEKIT_CHAIN_ENV: "mainnet",
      ROBINHOOD_NETWORK: "testnet",
      X402_FACILITATOR_NETWORKS: "hyperevm,robinhood",
      X402_FACILITATOR_ALLOW_EXPERIMENTAL: "1",
    };
    const loaded = loadFacilitatorFromEnv(env);
    const supported = await loaded?.facilitator.getSupported();
    expect(supported?.kinds.map((kind) => kind.network).sort()).toEqual(["eip155:46630", "eip155:999"]);
    expect(loaded?.facilitator.killed()).toBe(false);
    env.X402_FACILITATOR_KILL = "1";
    expect(loaded?.facilitator.killed()).toBe(true);
  });

  it("defaults the recipient allowlist to the caller's own payTo addresses", async () => {
    const loaded = loadFacilitatorFromEnv(
      { X402_RELAYER_PRIVATE_KEY: key, SETTLEKIT_CHAIN_ENV: "mainnet", X402_FACILITATOR_NETWORKS: "hyperevm" },
      { defaultAllowedPayTo: ["0x1111111111111111111111111111111111111111"] },
    );
    const requirements = requirementsFor(HYPEREVM, "1000000", "0x2222222222222222222222222222222222222222");
    const result = await loaded?.facilitator.verify(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ isValid: false, invalidReason: "recipient_not_allowed" });
  });

  it("rejects a malformed relayer key", () => {
    expect(() => loadFacilitatorFromEnv({ X402_RELAYER_PRIVATE_KEY: "0x1234" })).toThrow(/32-byte/);
  });
});

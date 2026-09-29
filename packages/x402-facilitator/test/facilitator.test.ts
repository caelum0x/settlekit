import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDomain } from "viem";
import { getEvmChain } from "@settlekit/chains";
import {
  FacilitatorConfigError,
  GasGuard,
  InMemoryNonceStore,
  REASONS,
  createSettleKitFacilitator,
  findFacilitatorAssetByCaip2,
  fromAtomicAmount,
  getFacilitatorAsset,
  listFacilitatorAssets,
  toAtomicAmount,
  type FacilitatorAsset,
  type SettleKitFacilitatorConfig,
} from "../src/index.js";
import {
  MERCHANT,
  OTHER_MERCHANT,
  RELAYER,
  TX_HASH,
  fakeChain,
  fakeGas,
  other,
  payer,
  requirementsFor,
  signPayment,
  withFrom,
  type FakeChainOptions,
} from "./fixtures.js";

const HYPEREVM = getFacilitatorAsset("hyperevm", "mainnet") as FacilitatorAsset;
const ETHEREUM = getFacilitatorAsset("ethereum", "mainnet") as FacilitatorAsset;
const ROBINHOOD = getFacilitatorAsset("robinhood", "mainnet") as FacilitatorAsset;
const TEMPO = getFacilitatorAsset("tempo", "mainnet") as FacilitatorAsset;
const ONE_USDC = "1000000";

function setup(
  overrides: Partial<SettleKitFacilitatorConfig> = {},
  chain: Partial<FakeChainOptions> = {},
  asset: FacilitatorAsset = HYPEREVM,
) {
  const fake = fakeChain({ asset, ...chain });
  const gas = fakeGas();
  const guard = new GasGuard(gas, {
    networks: {
      [asset.caip2]: { maxFeePerSettlement: 10n ** 16n, dailyBudget: 10n ** 17n },
    },
  });
  const facilitator = createSettleKitFacilitator({
    env: "mainnet",
    enabledNetworks: [asset.network],
    signerFor: (caip2) => (caip2 === asset.caip2 ? fake.signer : undefined),
    gasGuard: guard,
    maxAmountPerSettlement: 100_000_000n,
    ...overrides,
  });
  return { facilitator, fake, gas, guard };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("assets", () => {
  it("takes every token address from the @settlekit/chains registry", () => {
    for (const env of ["mainnet", "testnet"] as const) {
      for (const asset of listFacilitatorAssets(env)) {
        const spec = getEvmChain(asset.network, env);
        expect(asset.address).toBe(spec?.token.address);
        expect(asset.chainId).toBe(spec?.chainId);
        expect(asset.caip2).toBe(spec?.caip2);
      }
    }
  });

  it("recomputes the on-chain DOMAIN_SEPARATOR from the pinned EIP-712 domains (read 2026-09-29)", () => {
    const onChain: Array<[FacilitatorAsset | undefined, string]> = [
      [ETHEREUM, "0x06c37168a7db5138defc7866392bb87a741f9b3d104deb5094588ce041cae335"],
      [HYPEREVM, "0x70a72998ad787d1a9152a8f88ccfe0766b1cb293b6b4011b34523035da10b0a3"],
      [ROBINHOOD, "0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036"],
      [getFacilitatorAsset("hyperevm", "testnet"), "0xf26c39ac3b2040472381fddbd35212755a23586ffb86e608e151af6caa1d465e"],
      [getFacilitatorAsset("ethereum", "testnet"), "0xb90e5057db141a932946e64d09ccb7ffc9b00bd79fec26f698d29af0c83320a6"],
    ];
    for (const [asset, separator] of onChain) {
      expect(asset?.eip712).toBeDefined();
      const domain = {
        name: asset?.eip712?.name as string,
        version: asset?.eip712?.version as string,
        chainId: asset?.chainId as number,
        verifyingContract: asset?.address as `0x${string}`,
      };
      expect(
        hashDomain({
          domain,
          types: {
            EIP712Domain: [
              { name: "name", type: "string" },
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
          },
        }),
      ).toBe(separator);
    }
  });

  it("marks Tempo and the Robinhood testnet as experimental Permit2 and omits Tempo Moderato", () => {
    expect(TEMPO.transferMethod).toBe("permit2");
    expect(TEMPO.experimental).toBe(true);
    expect(getFacilitatorAsset("robinhood", "testnet")?.transferMethod).toBe("permit2");
    expect(getFacilitatorAsset("tempo", "testnet")).toBeUndefined();
    expect(ROBINHOOD.eip712).toEqual({ name: "Global Dollar", version: "1" });
    expect(findFacilitatorAssetByCaip2("eip155:999")?.symbol).toBe("USDC");
  });

  it("converts decimal amounts to base units and back", () => {
    expect(toAtomicAmount("0.25", 6)).toBe("250000");
    expect(toAtomicAmount("12", 6)).toBe("12000000");
    expect(fromAtomicAmount("250000", 6)).toBe("0.25");
    expect(() => toAtomicAmount("0.0000001", 6)).toThrow();
    expect(() => toAtomicAmount("-1", 6)).toThrow();
  });
});

describe("configuration", () => {
  it("refuses experimental assets without an explicit opt-in", () => {
    expect(() => setup({}, {}, TEMPO)).toThrow(FacilitatorConfigError);
  });

  it("refuses a network with no settleable asset or no relayer signer", () => {
    expect(() => setup({ env: "testnet", enabledNetworks: ["tempo"], allowExperimental: true })).toThrow(/no settleable asset/);
    expect(() => setup({ enabledNetworks: ["ethereum"] })).toThrow(/no relayer signer/);
  });

  it("advertises one exact v2 kind per enabled network plus the relayer signer", async () => {
    const { facilitator } = setup();
    const supported = await facilitator.getSupported();
    expect(supported.kinds).toEqual([{ x402Version: 2, scheme: "exact", network: "eip155:999" }]);
    expect(Object.values(supported.signers).flat()).toContain(RELAYER);
  });
});

describe("verify", () => {
  it("accepts a valid EIP-3009 authorization (HyperEVM USDC, domain USDC/2)", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.verify(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ isValid: true, payer: payer.address });
  });

  it("accepts Robinhood USDG signed over the Global Dollar/1 domain", async () => {
    const { facilitator } = setup({}, {}, ROBINHOOD);
    const requirements = requirementsFor(ROBINHOOD, ONE_USDC);
    expect(await facilitator.verify(await signPayment(requirements), requirements)).toMatchObject({ isValid: true });
  });

  it("rejects a signature that does not recover to the payer", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const forged = withFrom(await signPayment(requirements, other), payer.address);
    const result = await facilitator.verify(forged, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/signature/);
  });

  it("rejects an expired authorization", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC, MERCHANT, { maxTimeoutSeconds: 60 });
    vi.useFakeTimers({ now: Date.now() - 3_600_000 });
    const stale = await signPayment(requirements);
    vi.useRealTimers();
    const result = await facilitator.verify(stale, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/valid_before|expired/i);
  });

  it("rejects a requirement for a token other than the registry asset", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC, MERCHANT, {
      asset: "0x0000000000000000000000000000000000000bad",
    });
    const payment = await signPayment(requirements);
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: false, invalidReason: REASONS.assetNotAllowed });
  });

  it("rejects an EIP-712 domain that differs from the token's", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC, MERCHANT, { extra: { name: "USD Coin", version: "2" } });
    const payment = await signPayment(requirements);
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: false, invalidReason: REASONS.domainMismatch });
  });

  it("rejects an authorization paying a different recipient", async () => {
    const { facilitator } = setup();
    const signedFor = requirementsFor(HYPEREVM, ONE_USDC, OTHER_MERCHANT);
    const payment = await signPayment(signedFor);
    const expected = requirementsFor(HYPEREVM, ONE_USDC, MERCHANT);
    const result = await facilitator.verify({ ...payment, accepted: expected }, expected);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/recipient/);
  });

  it("enforces the recipient allowlist", async () => {
    const { facilitator } = setup({ allowedPayTo: [OTHER_MERCHANT] });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.verify(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ isValid: false, invalidReason: REASONS.recipientNotAllowed });
  });

  it("rejects an underpaying authorization", async () => {
    const { facilitator } = setup();
    const payment = await signPayment(requirementsFor(HYPEREVM, "900000"));
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.verify({ ...payment, accepted: requirements }, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/value/);
  });

  it("rejects amounts above the per-settlement cap", async () => {
    const { facilitator } = setup({ maxAmountPerSettlement: 500_000n });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.verify(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ isValid: false, invalidReason: REASONS.amountExceedsLimit });
  });

  it("rejects a network that is not enabled", async () => {
    const { facilitator } = setup();
    const requirements = requirementsFor(ETHEREUM, ONE_USDC);
    const result = await facilitator.verify(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ isValid: false, invalidReason: REASONS.networkNotEnabled });
  });

  it("rejects an EIP-3009 payload for a Permit2-only asset", async () => {
    const { facilitator } = setup({ allowExperimental: true }, {}, TEMPO);
    const requirements = requirementsFor(TEMPO, ONE_USDC, MERCHANT, { extra: { name: "USDC", version: "2" } });
    const payment = await signPayment(requirements);
    const result = await facilitator.verify(payment, requirementsFor(TEMPO, ONE_USDC));
    expect(result).toMatchObject({ isValid: false, invalidReason: REASONS.transferMethod });
  });

  it("settles a Permit2 authorization through the x402 Permit2 proxy (Tempo, experimental)", async () => {
    const { facilitator, fake } = setup({ allowExperimental: true }, {}, TEMPO);
    const requirements = requirementsFor(TEMPO, ONE_USDC);
    const payment = await signPayment(requirements);
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: true, payer: payer.address });
    expect(await facilitator.settle(payment, requirements)).toMatchObject({ success: true, transaction: TX_HASH });
    expect(fake.writes.map((write) => write.functionName)).toEqual(["settle"]);
    expect(await facilitator.settle(payment, requirements)).toMatchObject({ errorReason: REASONS.nonceUsed });
  });

  it("refuses everything while the kill switch is engaged", async () => {
    let killed = false;
    const { facilitator, fake } = setup({ killSwitch: () => killed });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const payment = await signPayment(requirements);
    killed = true;
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: false, invalidReason: REASONS.disabled });
    expect(await facilitator.settle(payment, requirements)).toMatchObject({ success: false, errorReason: REASONS.disabled });
    expect(fake.writes).toHaveLength(0);
    killed = false;
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: true });
  });
});

describe("settle", () => {
  it("submits transferWithAuthorization once and returns the transaction", async () => {
    const { facilitator, fake, guard } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ success: true, transaction: TX_HASH, network: "eip155:999", payer: payer.address });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.functionName).toBe("transferWithAuthorization");
    expect(guard.spentLastDay("eip155:999")).toBe(120_000n * 1_000_000_000n);
  });

  it("refuses to replay a settled nonce without spending gas", async () => {
    const { facilitator, fake } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const payment = await signPayment(requirements);
    expect((await facilitator.settle(payment, requirements)).success).toBe(true);
    expect(await facilitator.settle(payment, requirements)).toMatchObject({ success: false, errorReason: REASONS.nonceUsed });
    expect(await facilitator.verify(payment, requirements)).toMatchObject({ isValid: false, invalidReason: REASONS.nonceUsed });
    expect(fake.writes).toHaveLength(1);
  });

  it("shares replay protection through the nonce store across instances", async () => {
    const nonceStore = new InMemoryNonceStore();
    const a = setup({ nonceStore });
    const b = setup({ nonceStore });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const payment = await signPayment(requirements);
    expect((await a.facilitator.settle(payment, requirements)).success).toBe(true);
    expect((await b.facilitator.settle(payment, requirements)).errorReason).toBe(REASONS.nonceUsed);
    expect(b.fake.writes).toHaveLength(0);
  });

  it("does not settle when verification fails (bad signature)", async () => {
    const { facilitator, fake } = setup();
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const forged = withFrom(await signPayment(requirements, other), payer.address);
    const result = await facilitator.settle(forged, requirements);
    expect(result.success).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  it("does not broadcast when the pre-settle simulation reverts", async () => {
    const { facilitator, fake } = setup({}, { simulateReverts: true });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result.success).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  it("releases the nonce when submission fails before broadcast", async () => {
    const nonceStore = new InMemoryNonceStore();
    const failing = setup({ nonceStore }, { submitThrows: true });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const payment = await signPayment(requirements);
    expect((await failing.facilitator.settle(payment, requirements)).success).toBe(false);
    const healthy = setup({ nonceStore });
    expect((await healthy.facilitator.settle(payment, requirements)).success).toBe(true);
  });

  it("gas guard: refuses when one settlement would exceed the fee cap", async () => {
    const { facilitator, fake, gas } = setup();
    gas.price = 10n ** 12n; // 120k gas * 1000 gwei = 0.12 native > 0.01 cap
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "gas_budget_exceeded" });
    expect(fake.writes).toHaveLength(0);
  });

  it("gas guard: refuses once the rolling daily budget is spent", async () => {
    const { facilitator, fake, guard } = setup();
    guard.record("eip155:999", 10n ** 17n);
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "gas_budget_exceeded" });
    expect(fake.writes).toHaveLength(0);
  });

  it("gas guard: refuses when the relayer cannot cover the fee", async () => {
    const { facilitator, gas } = setup();
    gas.balance = 1n;
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "relayer_balance_too_low" });
  });

  it("gas guard: refuses a network with no configured budget", async () => {
    const fake = fakeChain({ asset: HYPEREVM });
    const facilitator = createSettleKitFacilitator({
      env: "mainnet",
      enabledNetworks: ["hyperevm"],
      signerFor: () => fake.signer,
      gasGuard: new GasGuard(fakeGas(), { networks: {} }),
      maxAmountPerSettlement: 100_000_000n,
    });
    const requirements = requirementsFor(HYPEREVM, ONE_USDC);
    const result = await facilitator.settle(await signPayment(requirements), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "gas_budget_missing" });
  });
});

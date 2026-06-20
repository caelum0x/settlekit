import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  ArcPaymentClient,
  LocalAppKitSdk,
  configureAppKit,
  normalizeStatus,
} from "../src/index.js";

const ADAPTER = "viem:0xwallet";

function client(opts: { kitKey?: string; sdk?: LocalAppKitSdk } = {}): {
  arc: ArcPaymentClient<string>;
  sdk: LocalAppKitSdk;
} {
  const sdk = opts.sdk ?? new LocalAppKitSdk();
  const arc = configureAppKit<string>({
    sdk,
    env: {},
    ...(opts.kitKey !== undefined ? { kitKey: opts.kitKey } : {}),
  });
  return { arc, sdk };
}

describe("normalizeStatus", () => {
  it("maps SDK states onto the normalized set", () => {
    expect(normalizeStatus("success")).toBe("success");
    expect(normalizeStatus("CONFIRMED")).toBe("success");
    expect(normalizeStatus("pending")).toBe("pending");
    expect(normalizeStatus("submitted")).toBe("pending");
    expect(normalizeStatus("reverted")).toBe("failed");
    expect(normalizeStatus(undefined)).toBe("failed");
  });
});

describe("send", () => {
  it("transfers and returns a normalized success result", async () => {
    const { arc, sdk } = client();
    const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount: "1.50" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.kind).toBe("send");
    expect(res.value.status).toBe("success");
    expect(res.value.txHash).toMatch(/^0xlocal/);
    expect(res.value.explorerUrl).toContain("arcscan");
    expect(sdk.calls()).toEqual([{ kind: "send", amount: "1.50", chain: "Arc_Testnet" }]);
  });

  it("defaults the token to USDC", async () => {
    const { arc } = client();
    const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount: "1" });
    expect(isOk(res)).toBe(true);
  });

  it("rejects an unsupported chain", async () => {
    const { arc } = client();
    const res = await arc.send({ adapter: ADAPTER, chain: "Solana" as never, to: "0xbob", amount: "1" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects a non-positive or malformed amount", async () => {
    const { arc } = client();
    for (const amount of ["0", "-1", "1.2345678", "abc", ""]) {
      const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount });
      expect(isErr(res)).toBe(true);
    }
  });

  it("rejects an empty recipient", async () => {
    const { arc } = client();
    const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "  ", amount: "1" });
    expect(isErr(res)).toBe(true);
  });

  it("maps a thrown SDK error to a retryable integration_error", async () => {
    const { arc } = client({ sdk: new LocalAppKitSdk({ throwOn: ["send"] }) });
    const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount: "1" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
    expect(res.error.retryable).toBe(true);
  });

  it("maps a non-success SDK state to payment_failed", async () => {
    const { arc } = client({ sdk: new LocalAppKitSdk({ state: "reverted" }) });
    const res = await arc.send({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount: "1" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("payment_failed");
  });
});

describe("estimateSend", () => {
  it("returns an estimate", async () => {
    const { arc } = client();
    const res = await arc.estimateSend({ adapter: ADAPTER, chain: "Arc_Testnet", to: "0xbob", amount: "1" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.gas).toBe("21000");
  });
});

describe("bridge", () => {
  it("bridges across chains", async () => {
    const { arc } = client();
    const res = await arc.bridge({
      adapter: ADAPTER,
      fromChain: "Ethereum_Sepolia",
      toChain: "Arc_Testnet",
      amount: "2.00",
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.kind).toBe("bridge");
  });

  it("rejects an unsupported destination chain", async () => {
    const { arc } = client();
    const res = await arc.bridge({
      adapter: ADAPTER,
      fromChain: "Arc_Testnet",
      toChain: "Polygon" as never,
      amount: "1",
    });
    expect(isErr(res)).toBe(true);
  });
});

describe("swap", () => {
  it("requires a kit key", async () => {
    const { arc } = client();
    const res = await arc.swap({
      adapter: ADAPTER,
      chain: "Arc_Testnet",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "1",
    });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("unauthorized");
  });

  it("swaps when a kit key is configured", async () => {
    const { arc } = client({ kitKey: "kit_test" });
    const res = await arc.swap({
      adapter: ADAPTER,
      chain: "Arc_Testnet",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "1",
    });
    expect(isOk(res)).toBe(true);
  });

  it("rejects swapping a token for itself", async () => {
    const { arc } = client({ kitKey: "kit_test" });
    const res = await arc.swap({
      adapter: ADAPTER,
      chain: "Arc_Testnet",
      tokenIn: "USDC",
      tokenOut: "USDC",
      amountIn: "1",
    });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });
});

describe("unified balance", () => {
  it("deposits and spends", async () => {
    const { arc, sdk } = client();
    const dep = await arc.deposit({ adapter: ADAPTER, chain: "Base_Sepolia", amount: "5" });
    expect(isOk(dep)).toBe(true);
    const spend = await arc.spend({
      adapter: ADAPTER,
      toChain: "Arc_Testnet",
      recipientAddress: "0xmerchant",
      amount: "1.50",
    });
    expect(isOk(spend)).toBe(true);
    if (!isOk(spend)) return;
    expect(spend.value.kind).toBe("spend");
    expect(sdk.calls().map((c) => c.kind)).toEqual(["deposit", "spend"]);
  });

  it("rejects a spend with an empty recipient", async () => {
    const { arc } = client();
    const res = await arc.spend({
      adapter: ADAPTER,
      toChain: "Arc_Testnet",
      recipientAddress: "",
      amount: "1",
    });
    expect(isErr(res)).toBe(true);
  });
});

describe("configureAppKit", () => {
  it("reads the kit key from CIRCLE_KIT_KEY", async () => {
    const arc = configureAppKit<string>({
      sdk: new LocalAppKitSdk(),
      env: { CIRCLE_KIT_KEY: "kit_env" },
    });
    const res = await arc.swap({
      adapter: ADAPTER,
      chain: "Arc_Testnet",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "1",
    });
    expect(isOk(res)).toBe(true);
  });
});

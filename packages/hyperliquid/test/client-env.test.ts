import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ChainConfigError } from "@settlekit/chains";
import {
  buildUsdSendAction,
  createHyperCoreClient,
  HyperCoreSubmitError,
  hyperCoreTxUrl,
  loadHyperCoreConfig,
  splitSignature,
  type HyperCoreConfig,
  type HyperliquidTransport,
} from "../src/index.js";

const LEDGER = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/ledger-relay-fill.json", import.meta.url)), "utf8"),
) as unknown[];

const CONFIG: HyperCoreConfig = { network: "mainnet", hyperliquidChain: "Mainnet", apiUrl: "https://api.hyperliquid.xyz" };

function fakeTransport(reply: (endpoint: string, payload: unknown) => unknown): HyperliquidTransport & { sent: Array<[string, unknown]> } {
  const sent: Array<[string, unknown]> = [];
  return {
    isTestnet: false,
    sent,
    async request<T>(endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      sent.push([endpoint, payload]);
      const value = reply(endpoint, payload);
      if (value instanceof Error) throw value;
      return value as T;
    },
  };
}

const ACTION = buildUsdSendAction({
  destination: "0x1f2e3d4c5b6a79880706a5b4c3d2e1f0a9b8c7d6",
  amount: "25.5",
  time: 1790691879536,
  hyperliquidChain: "Mainnet",
  signatureChainId: 42161,
});
const SIGNATURE = splitSignature(
  "0x26c12bb58c7ac20eae8b661d7afe0399133a756e50c44a8b1d506c4274d6c4914bea04d55474e386d4bbb9564d99017526a86eaa08d1e5476214920ff31e64991c",
);

describe("createHyperCoreClient", () => {
  it("reads the ledger through the SDK's userNonFundingLedgerUpdates", async () => {
    const transport = fakeTransport(() => LEDGER);
    const client = createHyperCoreClient(CONFIG, { transport });
    const updates = await client.ledgerUpdates("0xff96fcf6fe1e60a53a3c912683d12a03a32ef4b0", 1790691000000);
    expect(updates).toHaveLength(1);
    expect(transport.sent).toEqual([
      ["info", { type: "userNonFundingLedgerUpdates", user: "0xff96fcf6fe1e60a53a3c912683d12a03a32ef4b0", startTime: 1790691000000 }],
    ]);
  });

  it("submits the signed usdSend to /exchange with nonce = time", async () => {
    const transport = fakeTransport(() => ({ status: "ok", response: { type: "default" } }));
    await createHyperCoreClient(CONFIG, { transport }).submitUsdSend(ACTION, SIGNATURE);
    expect(transport.sent).toEqual([["exchange", { action: ACTION, signature: SIGNATURE, nonce: ACTION.time }]]);
  });

  it("maps a Hyperliquid rejection to a rejected submit error", async () => {
    const transport = fakeTransport(() => ({ status: "err", response: "Insufficient balance for withdrawal" }));
    const error = await createHyperCoreClient(CONFIG, { transport }).submitUsdSend(ACTION, SIGNATURE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HyperCoreSubmitError);
    expect(error).toMatchObject({ rejected: true, message: expect.stringMatching(/Insufficient balance/) });
  });

  it("maps transport failures to a non-rejected submit error", async () => {
    const transport = fakeTransport(() => new Error("fetch failed"));
    const error = await createHyperCoreClient(CONFIG, { transport }).submitUsdSend(ACTION, SIGNATURE).catch((e: unknown) => e);
    expect(error).toMatchObject({ rejected: false, message: expect.stringMatching(/unavailable/) });
  });

  it("builds a real SDK HttpTransport by default", () => {
    const client = createHyperCoreClient({ ...CONFIG, network: "testnet", hyperliquidChain: "Testnet", apiUrl: "https://api.hyperliquid-testnet.xyz" });
    expect(client.config.network).toBe("testnet");
  });
});

describe("loadHyperCoreConfig", () => {
  it("is disabled unless HYPERCORE_ENABLED", () => {
    expect(loadHyperCoreConfig({})).toBeNull();
    expect(loadHyperCoreConfig({ HYPERCORE_ENABLED: "false" })).toBeNull();
  });

  it("defaults to testnet, follows SETTLEKIT_CHAIN_ENV, and honours HYPERCORE_NETWORK", () => {
    expect(loadHyperCoreConfig({ HYPERCORE_ENABLED: "true" })).toEqual({
      network: "testnet",
      hyperliquidChain: "Testnet",
      apiUrl: "https://api.hyperliquid-testnet.xyz",
    });
    expect(loadHyperCoreConfig({ HYPERCORE_ENABLED: "1", SETTLEKIT_CHAIN_ENV: "mainnet" })).toEqual({
      network: "mainnet",
      hyperliquidChain: "Mainnet",
      apiUrl: "https://api.hyperliquid.xyz",
    });
    expect(loadHyperCoreConfig({ HYPERCORE_ENABLED: "1", SETTLEKIT_CHAIN_ENV: "mainnet", HYPERCORE_NETWORK: "testnet" })?.network).toBe("testnet");
    expect(loadHyperCoreConfig({ HYPERCORE_ENABLED: "1", HYPERCORE_API_URL: "https://hl.example.com/" })?.apiUrl).toBe("https://hl.example.com");
  });

  it("refuses bad values", () => {
    expect(() => loadHyperCoreConfig({ HYPERCORE_ENABLED: "maybe" })).toThrow(ChainConfigError);
    expect(() => loadHyperCoreConfig({ HYPERCORE_ENABLED: "1", HYPERCORE_NETWORK: "devnet" })).toThrow(ChainConfigError);
    expect(() => loadHyperCoreConfig({ HYPERCORE_ENABLED: "1", HYPERCORE_API_URL: "ftp://x" })).toThrow(ChainConfigError);
  });

  it("links the Hyperliquid explorer per network", () => {
    expect(hyperCoreTxUrl("0xabc")).toBe("https://app.hyperliquid.xyz/explorer/tx/0xabc");
    expect(hyperCoreTxUrl("0xabc", "testnet")).toBe("https://app.hyperliquid-testnet.xyz/explorer/tx/0xabc");
  });
});

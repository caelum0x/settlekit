/**
 * Display logic behind NetworkPicker / ZcashPay / receipts: honest network
 * and asset labels from the registry, picker grouping, quote countdown,
 * ZIP-321 request text and explorer links.
 */
import { describe, expect, it } from "vitest";
import { createCheckoutSession } from "@settlekit/payments";

import { describeNetwork, explorerTxUrl, formatAsset, formatNetwork } from "../lib/format";
import type { NetworkOption } from "../lib/network-options";
import { describeCountdown, explorerLink, formatCountdown, groupNetworkOptions, remainingMs, shortHash } from "../lib/pay-display";
import { buildZcashPaymentRequest } from "../lib/zcash";
import { ZEC_PAY_TO, lockedQuote, price, product } from "./harness";

describe("network labels", () => {
  it.each([
    ["robinhood", "mainnet", "Robinhood Chain", "USDG", []],
    ["tempo", "mainnet", "Tempo", "USDC.e", ["bridged"]],
    ["tempo", "testnet", "Tempo Moderato", "pathUSD", ["testnet"]],
    ["base", "testnet", "Base Sepolia", "USDC", ["testnet"]],
    ["arbitrum", "mainnet", "Arbitrum One", "USDC", []],
    ["hyperevm", "mainnet", "HyperEVM", "USDC", []],
    ["arc", "mainnet", "Arc Testnet", "USDC", ["testnet"]],
    ["zcash", "mainnet", "Zcash", "ZEC", ["transparent"]],
    ["solana", "testnet", "Solana Devnet", "USDC", ["testnet"]],
  ] as const)("%s on %s is %s paid in %s", (network, env, name, asset, badges) => {
    expect(describeNetwork(network, env)).toMatchObject({ name, asset, badges: [...badges] });
    expect(formatNetwork(network, env)).toBe(name);
    expect(formatAsset(network, env)).toBe(asset);
  });

  it("links each network's explorer", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(explorerTxUrl("base", hash)).toBe(`https://basescan.org/tx/${hash}`);
    expect(explorerTxUrl("base", hash, { chainEnv: "testnet" })).toBe(`https://sepolia.basescan.org/tx/${hash}`);
    expect(explorerTxUrl("robinhood", hash)).toBe(`https://robinhoodchain.blockscout.com/tx/${hash}`);
    expect(explorerTxUrl("hyperevm", hash, { chainEnv: "testnet" })).toBe("");
    expect(explorerTxUrl("zcash", "ab".repeat(32))).toBe(`https://blockchair.com/zcash/transaction/${"ab".repeat(32)}`);
    expect(explorerTxUrl("solana", "sig", { solanaCluster: "devnet" })).toBe("https://solscan.io/tx/sig?cluster=devnet");
  });
});

describe("picker grouping", () => {
  const option = (network: NetworkOption["network"], family: NetworkOption["family"], available = true): NetworkOption => ({
    network,
    family,
    name: network,
    asset: "USDC",
    badges: [],
    env: "mainnet",
    available,
  });

  it("orders Solana, EVM chains, Zcash and drops unavailable networks and empty groups", () => {
    const groups = groupNetworkOptions([
      option("zcash", "zcash"),
      option("base", "evm"),
      option("tempo", "evm"),
      option("arbitrum", "evm", false),
    ]);
    expect(groups.map((group) => [group.label, group.options.map((o) => o.network)])).toEqual([
      ["EVM chains", ["base", "tempo"]],
      ["Zcash", ["zcash"]],
    ]);
  });
});

describe("quote countdown", () => {
  const expiresAt = "2026-09-29T10:15:00.000Z";
  const at = (iso: string) => new Date(iso).getTime();

  it("counts down to the quote expiry and stops at zero", () => {
    expect(formatCountdown(remainingMs(expiresAt, at("2026-09-29T10:00:00.000Z")))).toBe("15:00");
    expect(formatCountdown(remainingMs(expiresAt, at("2026-09-29T10:14:55.500Z")))).toBe("0:05");
    expect(remainingMs(expiresAt, at("2026-09-29T10:16:00.000Z"))).toBe(0);
    expect(remainingMs("not a date", 0)).toBe(0);
  });

  it("reads naturally for screen readers", () => {
    expect(describeCountdown(61_000)).toBe("1 minute 1 second");
    expect(describeCountdown(120_000)).toBe("2 minutes");
    expect(describeCountdown(0)).toBe("0 seconds");
  });
});

describe("ZIP-321 display", () => {
  it("shows the exact tagged amount, the address and a memo-free URI", () => {
    const session = {
      ...createCheckoutSession({
        organizationId: "org",
        merchantId: "mch",
        items: [{ lineItem: { productId: product.id, priceId: price.id, quantity: 1 }, price }],
        payToAddress: "0x3333333333333333333333333333333333333333",
        network: "zcash",
      }),
      payToByNetwork: { zcash: ZEC_PAY_TO },
      settlementQuote: lockedQuote("1738001", new Date("2026-09-29T10:00:00.000Z")),
    };
    const request = buildZcashPaymentRequest(session, { merchantName: "Acme & Co", productName: "Pro license" });
    expect(request).toEqual({
      uri: `zcash:${ZEC_PAY_TO}?amount=0.01738001&label=Acme%20%26%20Co&message=Pro%20license`,
      address: ZEC_PAY_TO,
      amountZec: "0.01738001",
      amountZats: "1738001",
    });
  });
});

describe("links", () => {
  it("shortens hashes and builds explorer links only when an explorer exists", () => {
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xababab…ababab");
    expect(shortHash("short")).toBe("short");
    expect(explorerLink("https://basescan.org/tx/", "0x1")).toBe("https://basescan.org/tx/0x1");
    expect(explorerLink(null, "0x1")).toBe("");
  });
});

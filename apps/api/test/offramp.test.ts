import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { configuredOfframps, offrampLinks } from "../src/payouts/offramp.js";

const WALLET = "0x7878787878787878787878787878787878787878";

describe("off-ramp hand-off", () => {
  it("offers nothing until a partner key is configured", () => {
    expect(offrampLinks({ network: "base", amount: "250", wallet: WALLET }, {})).toEqual([]);
    expect(configuredOfframps({})).toEqual([]);
  });

  it("prefills amount, network and the merchant's own wallet per partner", () => {
    const env = { TRANSAK_API_KEY: "tk_pub", RAMP_HOST_API_KEY: "ramp_pub", MOONPAY_PUBLISHABLE_KEY: "pk_x", MOONPAY_SECRET_KEY: "sk_x" };
    const links = offrampLinks({ network: "base", amount: "250.5", wallet: WALLET, returnUrl: "https://dash.test/payouts" }, env);
    expect(links.map((l) => l.provider)).toEqual(["transak", "moonpay", "ramp"]);

    const transak = new URL(links[0]!.url);
    expect(transak.origin).toBe("https://global.transak.com");
    expect(Object.fromEntries(transak.searchParams)).toMatchObject({
      apiKey: "tk_pub",
      productsAvailed: "SELL",
      cryptoCurrencyCode: "USDC",
      network: "base",
      cryptoAmount: "250.5",
      walletAddress: WALLET,
    });

    const moonpay = new URL(links[1]!.url);
    expect(moonpay.searchParams.get("baseCurrencyCode")).toBe("usdc_base");
    const signed = links[1]!.url.slice(links[1]!.url.indexOf("?"), links[1]!.url.indexOf("&signature="));
    expect(moonpay.searchParams.get("signature")).toBe(createHmac("sha256", "sk_x").update(signed).digest("base64"));

    const ramp = new URL(links[2]!.url);
    expect(Object.fromEntries(ramp.searchParams)).toMatchObject({ swapAsset: "BASE_USDC", swapAmount: "250500000", userAddress: WALLET, enabledFlows: "OFFRAMP" });
  });

  it("skips partners that do not support the network and validates the amount", () => {
    const env = { TRANSAK_API_KEY: "tk", RAMP_HOST_API_KEY: "r" };
    expect(offrampLinks({ network: "zcash", amount: "1", wallet: "t1abc" }, env)).toEqual([]);
    expect(offrampLinks({ network: "solana", amount: "1", wallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, env).map((l) => l.provider)).toEqual(["transak", "ramp"]);
    expect(() => offrampLinks({ network: "base", amount: "0", wallet: WALLET }, env)).toThrow(/positive/);
    expect(() => offrampLinks({ network: "base", amount: "abc", wallet: WALLET }, env)).toThrow(/positive/);
    expect(new URL(offrampLinks({ network: "base", amount: "1", wallet: WALLET }, { ...env, TRANSAK_ENV: "staging" })[0]!.url).origin).toBe(
      "https://global-stg.transak.com",
    );
  });
});

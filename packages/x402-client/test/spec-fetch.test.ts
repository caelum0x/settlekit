import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { getEvmChain } from "@settlekit/chains";
import { createSpecX402Fetch, readPaymentResponse, settleKitAllowedAssets } from "../src/index.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const MERCHANT = "0x1111111111111111111111111111111111111111";
const hyperevm = getEvmChain("hyperevm", "mainnet");
const base = getEvmChain("base", "mainnet");

function offer(spec: typeof hyperevm, amount: string, name: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: spec?.caip2 as `${string}:${string}`,
    asset: spec?.token.address as string,
    amount,
    payTo: MERCHANT,
    maxTimeoutSeconds: 300,
    extra: { name, version: "2" },
  };
}

/** A fake server: 402 with `accepts` until a PAYMENT-SIGNATURE arrives. */
function fakeServer(accepts: PaymentRequirements[]) {
  const seen: PaymentPayload[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const signature = request.headers.get("PAYMENT-SIGNATURE");
    if (!signature) {
      const required: PaymentRequired = {
        x402Version: 2,
        resource: { url: request.url, description: "paid", mimeType: "application/json" },
        accepts,
      };
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } });
    }
    const payload = decodePaymentSignatureHeader(signature);
    seen.push(payload);
    const receipt = encodePaymentResponseHeader({
      success: true,
      transaction: `0x${"cd".repeat(32)}`,
      network: payload.accepted.network,
      payer: account.address,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": receipt } });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe("createSpecX402Fetch", () => {
  it("pays a HyperEVM USDC challenge with a valid EIP-3009 signature", async () => {
    const server = fakeServer([offer(base, "10000", "USD Coin"), offer(hyperevm, "10000", "USDC")]);
    const pay = createSpecX402Fetch({ fetch: server.fetchImpl, evmSigner: account, preferNetworks: ["eip155:999"] });
    const response = await pay("https://api.settlekit.test/v1/x402/research");
    expect(response.status).toBe(200);
    expect(readPaymentResponse(response)).toMatchObject({ success: true, network: "eip155:999" });

    const payload = server.seen[0] as PaymentPayload;
    expect(payload.accepted.network).toBe("eip155:999");
    const auth = payload.payload.authorization as Record<string, string>;
    expect(auth.to.toLowerCase()).toBe(MERCHANT);
    const signer = await recoverTypedDataAddress({
      domain: { name: "USDC", version: "2", chainId: 999, verifyingContract: hyperevm?.token.address },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value as string),
        validAfter: BigInt(auth.validAfter as string),
        validBefore: BigInt(auth.validBefore as string),
        nonce: auth.nonce as `0x${string}`,
      },
      signature: payload.payload.signature as `0x${string}`,
    });
    expect(signer).toBe(account.address);
  });

  it("refuses to pay above the per-payment cap", async () => {
    const server = fakeServer([offer(hyperevm, "9000000", "USDC")]);
    const pay = createSpecX402Fetch({ fetch: server.fetchImpl, evmSigner: account, maxAtomicPerPayment: "1000000" });
    await expect(pay("https://api.settlekit.test/v1/x402/research")).rejects.toThrow(/spend|allow|exceed|cap|asset/i);
    expect(server.seen).toHaveLength(0);
  });

  it("refuses a token outside the SettleKit registry", async () => {
    const rogue = { ...offer(hyperevm, "10000", "USDC"), asset: "0x000000000000000000000000000000000000dEaD" };
    const server = fakeServer([rogue]);
    const pay = createSpecX402Fetch({ fetch: server.fetchImpl, evmSigner: account });
    await expect(pay("https://api.settlekit.test/v1/x402/research")).rejects.toThrow(/spend|allow|exceed|cap|asset/i);
    expect(server.seen).toHaveLength(0);
  });

  it("opts in every registry stablecoin plus Solana USDC", () => {
    const assets = settleKitAllowedAssets("mainnet", "123");
    expect(assets.map((asset) => asset.network)).toEqual(
      expect.arrayContaining(["eip155:1", "eip155:999", "eip155:4663", "eip155:4217", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"]),
    );
    expect(assets.every((asset) => asset.maxAmountPerPayment === "123")).toBe(true);
  });

  it("requires at least one signer", () => {
    expect(() => createSpecX402Fetch({})).toThrow(/signer/i);
  });
});

describe("resolveX402Network", () => {
  it("maps registry names to CAIP-2 ids per environment", async () => {
    const { resolveX402Network } = await import("../src/index.js");
    expect(resolveX402Network("hyperevm")).toBe("eip155:999");
    expect(resolveX402Network("robinhood", "testnet")).toBe("eip155:46630");
    expect(resolveX402Network("solana", "testnet")).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    expect(resolveX402Network("eip155:8453")).toBe("eip155:8453");
    expect(() => resolveX402Network("dogechain")).toThrow(/unknown/);
  });
});

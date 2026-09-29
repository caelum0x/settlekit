import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { buildIntegrations } from "../src/config/integrations.js";

describe("buildIntegrations verifier registry", () => {
  it("registers no verifiers when no chain is configured (everything fails closed)", () => {
    expect(buildIntegrations(loadConfig({})).verifiers).toEqual({});
  });

  it("registers one verifier per configured network", () => {
    const integrations = buildIntegrations(
      loadConfig({
        ARC_CHAIN_ID: "5042002",
        BASE_RPC_URL: "https://mainnet.base.org",
        SOLANA_CLUSTER: "devnet",
      }),
    );
    expect(Object.keys(integrations.verifiers).sort()).toEqual(["arc", "base", "solana"]);
    expect(integrations.verifiers.arc).toBe(integrations.arcVerifier);
  });

  it("the base verifier rejects proofs for other networks without touching the chain", async () => {
    const { verifiers } = buildIntegrations(loadConfig({ BASE_RPC_URL: "http://127.0.0.1:9" }));
    const result = await verifiers.base!(
      { txHash: `0x${"ab".repeat(32)}`, from: "", amount: "1", network: "arc", nonce: "" },
      {
        scheme: "x402",
        amount: "1",
        asset: "USDC",
        network: "arc",
        payTo: "0x1111111111111111111111111111111111111111",
        productId: "",
        resource: "r",
        nonce: "",
      },
    );
    expect(result).toEqual({ ok: false, reason: "Unsupported network: arc" });
  });
});

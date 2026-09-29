import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addressOf, deployOperatorVault } from "../src/arc-live.js";
import { arcChain } from "../src/vault-clients.js";

describe("arc live helpers (offline checks)", () => {
  it("derives the signer address from a private key", () => {
    expect(addressOf(`0x${"1".repeat(64)}`)).toBe("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
  });

  it("refuses to deploy without a compiled artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    const path = join(dir, "OperatorVault.json");
    await writeFile(path, JSON.stringify({ bytecode: { object: "" } }));
    const input = {
      chain: arcChain(),
      deployerKey: `0x${"1".repeat(64)}` as const,
      usdc: "0x3600000000000000000000000000000000000000" as const,
      owner: "0x00000000000000000000000000000000000000c1" as const,
      operator: "0x00000000000000000000000000000000000000e1" as const,
      caps: { perTxCap: 5n, dailyCap: 8n, escalateAbove: 2n },
      artifactPath: path,
    };
    await expect(deployOperatorVault(input)).rejects.toThrow(/forge build/);
    expect(arcChain().id).toBe(5_042_002);
  });
});

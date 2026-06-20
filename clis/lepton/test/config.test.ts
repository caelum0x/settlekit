import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_DEFAULTS,
  parseSettlementProvider,
  renderConfigEnv,
  resolveConfig,
} from "../src/commands/config.js";

describe("resolveConfig + renderConfigEnv", () => {
  it("emits all seven keys with documented defaults", () => {
    const config = resolveConfig({}, () => "FIXED_SECRET");
    const body = renderConfigEnv(config);
    expect(body).toContain(`PORT=${CONFIG_DEFAULTS.port}`);
    expect(body).toContain(`ORG_ID=${CONFIG_DEFAULTS.orgId}`);
    expect(body).toContain(`NETWORK=${CONFIG_DEFAULTS.network}`);
    expect(body).toContain("ESCROW_WALLET=");
    expect(body).toContain("CITATION_PROOF_SECRET=FIXED_SECRET");
    expect(body).toContain(`ARC_INDEXER_URL=${CONFIG_DEFAULTS.arcIndexerUrl}`);
    expect(body).toContain(`SETTLEMENT_PROVIDER=${CONFIG_DEFAULTS.settlementProvider}`);
    expect(body.endsWith("\n")).toBe(true);
  });

  it("honors supplied flags over defaults", () => {
    const config = resolveConfig(
      {
        port: "9999",
        orgId: "org_x",
        escrowWallet: "0xabc",
        citationProofSecret: "supplied",
        settlementProvider: "circle",
      },
      () => "SHOULD_NOT_BE_USED",
    );
    expect(config.PORT).toBe("9999");
    expect(config.ORG_ID).toBe("org_x");
    expect(config.ESCROW_WALLET).toBe("0xabc");
    expect(config.CITATION_PROOF_SECRET).toBe("supplied");
    expect(config.SETTLEMENT_PROVIDER).toBe("circle");
  });

  it("generates a secret only when none is supplied", () => {
    let calls = 0;
    resolveConfig({ citationProofSecret: "x" }, () => {
      calls += 1;
      return "gen";
    });
    expect(calls).toBe(0);
    resolveConfig({}, () => {
      calls += 1;
      return "gen";
    });
    expect(calls).toBe(1);
  });
});

describe("parseSettlementProvider", () => {
  it("accepts local and circle", () => {
    expect(parseSettlementProvider("local")).toBe("local");
    expect(parseSettlementProvider("circle")).toBe("circle");
  });

  it("rejects anything else", () => {
    expect(() => parseSettlementProvider("gateway")).toThrow(/Invalid --settlement-provider/);
  });
});

describe("file overwrite semantics (mirrors registerConfig)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lepton-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to overwrite without force, overwrites with force", () => {
    const out = join(dir, ".env.lepton");
    writeFileSync(out, "existing");

    // Same guard registerConfig uses.
    const refuse = (force: boolean): void => {
      if (existsSync(out) && !force) {
        throw new Error("Refusing to overwrite");
      }
      writeFileSync(out, renderConfigEnv(resolveConfig({}, () => "S")));
    };

    expect(() => refuse(false)).toThrow(/Refusing to overwrite/);
    expect(readFileSync(out, "utf8")).toBe("existing");

    refuse(true);
    expect(readFileSync(out, "utf8")).toContain("PORT=");
  });
});

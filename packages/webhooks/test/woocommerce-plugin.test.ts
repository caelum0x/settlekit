/**
 * The WooCommerce plugin (plugins/woocommerce) verifies SettleKit webhook
 * signatures in PHP. These tests run its standalone PHP suite and check the
 * PHP verifier against signatures made by this package. Skipped when no PHP
 * CLI is installed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signPayload, signPayloadWithSecrets } from "../src/index.js";

const PLUGIN = join(__dirname, "..", "..", "..", "plugins", "woocommerce", "settlekit-for-woocommerce");
const hasPhp = spawnSync("php", ["-v"]).status === 0;

describe.skipIf(!hasPhp)("SettleKit for WooCommerce (PHP)", () => {
  it("passes its standalone suite", () => {
    const out = execFileSync("php", [join(PLUGIN, "tests", "run.php")], { encoding: "utf8" });
    expect(out).toMatch(/0 failed/);
  });

  it("accepts signatures made by @settlekit/webhooks and rejects tampering", () => {
    const dir = mkdtempSync(join(tmpdir(), "sk-woo-"));
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { invoiceId: "inv_1", amount: "42" } });
    const file = join(dir, "body.json");
    writeFileSync(file, body);
    const now = 1_790_000_000;
    const header = signPayload("whsec_cross_check", body, now);
    const run = (secret: string, h: string, at: number) =>
      execFileSync("php", [join(PLUGIN, "tests", "verify-cli.php"), secret, file, h, String(at)], { encoding: "utf8" });
    expect(run("whsec_cross_check", header, now)).toBe("valid");
    expect(run("whsec_other", header, now)).toBe("invalid");
    expect(run("whsec_cross_check", header, now + 301)).toBe("invalid");
    const rotated = signPayloadWithSecrets(["whsec_new", "whsec_cross_check"], body, now);
    expect(run("whsec_cross_check", rotated, now)).toBe("valid");
    expect(run("whsec_new", rotated, now)).toBe("valid");
  });
});

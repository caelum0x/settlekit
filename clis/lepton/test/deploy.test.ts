import { describe, expect, it } from "vitest";
import {
  buildForgeArgs,
  parseDeployedAddresses,
  DEPLOY_SCRIPT_PATH,
} from "../src/commands/deploy.js";

describe("buildForgeArgs", () => {
  it("builds a dry-run with no rpc/key/broadcast", () => {
    expect(buildForgeArgs({ broadcast: false, forgeDir: "contracts" })).toEqual([
      "script",
      DEPLOY_SCRIPT_PATH,
    ]);
  });

  it("appends rpc, key, and broadcast when present", () => {
    expect(
      buildForgeArgs({
        rpcUrl: "https://rpc",
        privateKey: "0xkey",
        broadcast: true,
        forgeDir: "contracts",
      }),
    ).toEqual([
      "script",
      DEPLOY_SCRIPT_PATH,
      "--rpc-url",
      "https://rpc",
      "--private-key",
      "0xkey",
      "--broadcast",
    ]);
  });
});

describe("parseDeployedAddresses", () => {
  it("parses named return values", () => {
    const stdout = [
      "0: address distributor 0x1111111111111111111111111111111111111111",
      "1: address stream 0x2222222222222222222222222222222222222222",
      "2: address bond 0x3333333333333333333333333333333333333333",
    ].join("\n");
    expect(parseDeployedAddresses(stdout)).toEqual({
      distributor: "0x1111111111111111111111111111111111111111",
      stream: "0x2222222222222222222222222222222222222222",
      bond: "0x3333333333333333333333333333333333333333",
    });
  });

  it("falls back to the first three positional addresses", () => {
    const stdout = [
      "deployed 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "deployed 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "deployed 0xcccccccccccccccccccccccccccccccccccccccc",
    ].join("\n");
    expect(parseDeployedAddresses(stdout)).toEqual({
      distributor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      stream: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      bond: "0xcccccccccccccccccccccccccccccccccccccccc",
    });
  });

  it("returns undefined when fewer than three addresses are present", () => {
    expect(parseDeployedAddresses("nothing here")).toBeUndefined();
  });
});

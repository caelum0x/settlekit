import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { EVM_CHAINS, EVM_CHAIN_KEYS, findEvmChainById, getEvmChain, viemChainFor } from "../src/index.js";

function summary() {
  return Object.fromEntries(
    (["mainnet", "testnet"] as const).map((env) => [
      env,
      Object.fromEntries(
        Object.values(EVM_CHAINS[env]).map((spec) => [
          spec!.key,
          {
            chainId: spec!.chainId,
            caip2: spec!.caip2,
            rpc: spec!.defaultRpcUrl,
            explorer: spec!.explorerTx("0xabc"),
            token: `${spec!.token.symbol} ${spec!.token.address}`,
            minConfirmations: spec!.minConfirmations,
            label: spec!.label ?? null,
          },
        ]),
      ),
    ]),
  );
}

describe("EVM chain registry", () => {
  it("matches the verified plan table", () => {
    expect(summary()).toMatchSnapshot();
  });

  it("has checksum-valid token addresses and 6 decimals everywhere", () => {
    for (const env of ["mainnet", "testnet"] as const) {
      for (const spec of Object.values(EVM_CHAINS[env])) {
        expect(isAddress(spec!.token.address, { strict: true }), `${env}/${spec!.key}`).toBe(true);
        expect(spec!.token.decimals).toBe(6);
        expect(spec!.caip2).toBe(`eip155:${spec!.chainId}`);
        expect(spec!.env).toBe(env);
      }
    }
  });

  it("maps every spec to a viem chain with the same id", () => {
    for (const env of ["mainnet", "testnet"] as const) {
      for (const spec of Object.values(EVM_CHAINS[env])) {
        expect(viemChainFor(spec!).id).toBe(spec!.chainId);
      }
    }
  });

  it("covers every key on testnet and all but Arc on mainnet", () => {
    expect(Object.keys(EVM_CHAINS.testnet).sort()).toEqual([...EVM_CHAIN_KEYS].sort());
    expect(getEvmChain("arc", "mainnet")).toBeUndefined();
    expect(findEvmChainById(4663)?.key).toBe("robinhood");
    expect(findEvmChainById(42431)?.name).toBe("Tempo Moderato");
    expect(findEvmChainById(12345)).toBeUndefined();
  });
});

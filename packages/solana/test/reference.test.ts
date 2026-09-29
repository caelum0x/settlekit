import { describe, expect, it } from "vitest";
import { getAddressEncoder } from "@solana/kit";
import { createReference, isReference } from "../src/reference.js";
import { findReference } from "../src/find-reference.js";
import type { SignatureInfo } from "../src/rpc.js";
import { REFERENCE, fakeRpc, sig } from "./fixtures.js";

function info(seed: number, err: unknown = null): SignatureInfo {
  return {
    signature: sig(seed),
    slot: 291_000_000 + seed,
    err,
    memo: null,
    blockTime: 1_727_600_000 + seed,
    confirmationStatus: "confirmed",
  };
}

describe("createReference", () => {
  it("returns a fresh base58 32-byte key each call", () => {
    const a = createReference();
    const b = createReference();
    expect(a).not.toBe(b);
    expect(isReference(a)).toBe(true);
    expect(getAddressEncoder().encode(a as never)).toHaveLength(32);
  });

  it("rejects malformed references", () => {
    expect(isReference("0xabc")).toBe(false);
    expect(isReference("")).toBe(false);
  });
});

describe("findReference", () => {
  it("returns null when the reference was never used", async () => {
    expect(await findReference(fakeRpc(), REFERENCE)).toBeNull();
  });

  it("returns the oldest signature (RPC lists newest first)", async () => {
    const rpc = fakeRpc({ signaturesByAddress: { [REFERENCE]: [info(3), info(2), info(1)] } });
    const found = await findReference(rpc, REFERENCE);
    expect(found?.signature).toBe(sig(1));
    expect(rpc.calls[0]?.args[1]).toMatchObject({ limit: 1_000, commitment: "confirmed" });
  });

  it("skips failed attempts so a later successful payment is found", async () => {
    const rpc = fakeRpc({
      signaturesByAddress: { [REFERENCE]: [info(3, { InstructionError: [1, { Custom: 1 }] }), info(2), info(1, { InsufficientFundsForFee: null })] },
    });
    expect((await findReference(rpc, REFERENCE))?.signature).toBe(sig(2));
  });

  it("pages backwards with `before` until the history is exhausted", async () => {
    const history = [info(6), info(5), info(4), info(3), info(2)];
    const rpc = fakeRpc({ signaturesByAddress: { [REFERENCE]: history } });
    const found = await findReference(rpc, REFERENCE, { pageSize: 2 });
    expect(found?.signature).toBe(sig(2));
    const befores = rpc.calls.map((c) => (c.args[1] as { before?: string }).before);
    expect(befores).toEqual([undefined, sig(5), sig(3)]);
  });
});

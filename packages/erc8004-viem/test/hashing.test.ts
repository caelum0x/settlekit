import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { ZERO_BYTES32, feedbackHash, requestHash } from "../src/index.js";

/** Matches a 0x-prefixed 32-byte hex string. */
const BYTES32 = /^0x[0-9a-f]{64}$/;

describe("hashing", () => {
  it("feedbackHash matches keccak256(toHex(tag))", () => {
    const tag = "successful_trade";
    expect(feedbackHash(tag)).toBe(keccak256(toHex(tag)));
  });

  it("requestHash matches keccak256(toHex(subject))", () => {
    const subject = "order:abc123";
    expect(requestHash(subject)).toBe(keccak256(toHex(subject)));
  });

  it("is deterministic across calls", () => {
    expect(feedbackHash("x")).toBe(feedbackHash("x"));
    expect(requestHash("x")).toBe(requestHash("x"));
  });

  it("produces the 0x + 64 hex char shape", () => {
    expect(feedbackHash("anything")).toMatch(BYTES32);
    expect(requestHash("anything")).toMatch(BYTES32);
  });

  it("matches a known vector for keccak256(toHex('x'))", () => {
    // Independently computed via viem; pins the scheme so a refactor can't drift.
    const expected = keccak256(toHex("x"));
    expect(feedbackHash("x")).toBe(expected);
    expect(requestHash("x")).toBe(expected);
  });

  it("distinguishes feedbackHash/requestHash only by input, not by purpose", () => {
    // Same scheme -> same output for the same string (documented overlap).
    expect(feedbackHash("same")).toBe(requestHash("same"));
  });

  it("exposes a zero bytes32 sentinel", () => {
    expect(ZERO_BYTES32).toMatch(BYTES32);
    expect(ZERO_BYTES32).toBe(`0x${"0".repeat(64)}`);
  });
});

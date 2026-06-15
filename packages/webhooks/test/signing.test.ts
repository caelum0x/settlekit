import { describe, it, expect } from "vitest";
import {
  signPayload,
  verifySignature,
  parseSignatureHeader,
} from "../src/signing.js";

const SECRET = "whsec_test_0123456789abcdef";
const PAYLOAD = JSON.stringify({ id: "evt_abc", type: "payment.confirmed", n: 42 });

describe("signPayload / verifySignature", () => {
  it("produces a Stripe-style t=...,v1=... header", () => {
    const header = signPayload(SECRET, PAYLOAD, 1700000000);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it("round-trips: a freshly signed payload verifies", () => {
    const ts = 1700000000;
    const header = signPayload(SECRET, PAYLOAD, ts);
    // now == ts so age is 0, within tolerance.
    expect(verifySignature(SECRET, PAYLOAD, header, 300, ts)).toBe(true);
  });

  it("fails when the payload is tampered with", () => {
    const ts = 1700000000;
    const header = signPayload(SECRET, PAYLOAD, ts);
    const tampered = PAYLOAD.replace("42", "43");
    expect(verifySignature(SECRET, tampered, header, 300, ts)).toBe(false);
  });

  it("fails when the secret is wrong", () => {
    const ts = 1700000000;
    const header = signPayload(SECRET, PAYLOAD, ts);
    expect(verifySignature("whsec_wrong", PAYLOAD, header, 300, ts)).toBe(false);
  });

  it("fails when the signature is outside the tolerance window", () => {
    const ts = 1700000000;
    const header = signPayload(SECRET, PAYLOAD, ts);
    // now is 10 minutes later, tolerance only 5 minutes.
    expect(verifySignature(SECRET, PAYLOAD, header, 300, ts + 600)).toBe(false);
  });

  it("skips the freshness check when tolerance <= 0", () => {
    const ts = 1700000000;
    const header = signPayload(SECRET, PAYLOAD, ts);
    expect(verifySignature(SECRET, PAYLOAD, header, 0, ts + 99999)).toBe(true);
  });

  it("rejects malformed headers", () => {
    expect(verifySignature(SECRET, PAYLOAD, "garbage", 300, 1700000000)).toBe(false);
    expect(verifySignature(SECRET, PAYLOAD, "t=abc,v1=xyz", 300, 1700000000)).toBe(false);
    expect(verifySignature(SECRET, PAYLOAD, "v1=deadbeef", 300, 1700000000)).toBe(false);
  });
});

describe("parseSignatureHeader", () => {
  it("parses timestamp and signature regardless of order", () => {
    expect(parseSignatureHeader("v1=abc123,t=42")).toEqual({
      timestamp: 42,
      signature: "abc123",
    });
  });

  it("returns null for a missing field", () => {
    expect(parseSignatureHeader("t=42")).toBeNull();
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
  });

  it("returns null for a non-numeric timestamp", () => {
    expect(parseSignatureHeader("t=12.5,v1=abc")).toBeNull();
  });
});

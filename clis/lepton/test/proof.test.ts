import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  issueCitationProof,
  verifyCitationProof,
  type CitationProof,
} from "@settlekit/attribution";
import { parseCitationProof } from "../src/commands/proof.js";

const SECRET = "test-secret";

describe("proof issue/verify round-trip", () => {
  it("issues then verifies a proof", () => {
    const proof = issueCitationProof(
      { agent: "a", sourceIds: ["s1", "s2"], accessId: "acc" },
      SECRET,
    );
    const result = verifyCitationProof(proof, SECRET);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.agent).toBe("a");
      expect([...result.value.sourceIds].sort()).toEqual(["s1", "s2"]);
    }
  });

  it("round-trips through JSON serialization (the pipe path)", () => {
    const proof = issueCitationProof(
      { agent: "agent", sourceIds: ["s1"], accessId: "acc" },
      SECRET,
    );
    const parsed = parseCitationProof(JSON.stringify(proof));
    expect(isOk(verifyCitationProof(parsed, SECRET))).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const proof = issueCitationProof(
      { agent: "a", sourceIds: ["s1"], accessId: "acc" },
      SECRET,
    );
    const tampered: CitationProof = { ...proof, agent: "evil" };
    expect(isErr(verifyCitationProof(tampered, SECRET))).toBe(true);
  });

  it("rejects an expired proof when verified after expiry", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const proof = issueCitationProof(
      { agent: "a", sourceIds: ["s1"], accessId: "acc", ttlSeconds: 60 },
      SECRET,
      issuedAt,
    );
    const later = new Date(issuedAt.getTime() + 120_000);
    expect(isErr(verifyCitationProof(proof, SECRET, later))).toBe(true);
  });
});

describe("parseCitationProof", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseCitationProof("not json")).toThrow(/not valid JSON/);
  });

  it("throws on a proof missing required fields", () => {
    expect(() => parseCitationProof(JSON.stringify({ agent: "a" }))).toThrow(
      /missing required fields/,
    );
  });
});

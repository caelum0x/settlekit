import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  issueCitationProof,
  signClaim,
  signCitationProof,
  verifyCitationProof,
} from "../src/proof.js";
import type { ProofClaim } from "../src/types.js";

const SECRET = "shared-toll-secret";

const claim: ProofClaim = {
  agent: "agent_research_1",
  sourceIds: ["src_b", "src_a"],
  accessId: "acc_42",
  amountUsdc: "0.0008",
  issuedAt: "2026-06-19T00:00:00.000Z",
  nonce: "nonce-1",
};

describe("signCitationProof / verifyCitationProof", () => {
  it("round-trips a valid proof", () => {
    const proof = signCitationProof(claim, SECRET);
    const result = verifyCitationProof(proof, SECRET);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.accessId).toBe("acc_42");
    }
  });

  it("is canonical: sourceId order does not change the signature", () => {
    const a = signClaim(claim, SECRET);
    const b = signClaim({ ...claim, sourceIds: ["src_a", "src_b"] }, SECRET);
    expect(a).toBe(b);
  });

  it("rejects a tampered claim", () => {
    const proof = signCitationProof(claim, SECRET);
    const tampered = { ...proof, sourceIds: ["src_a", "src_b", "src_smuggled"] };
    expect(isErr(verifyCitationProof(tampered, SECRET))).toBe(true);
  });

  it("rejects the wrong secret", () => {
    const proof = signCitationProof(claim, SECRET);
    expect(isErr(verifyCitationProof(proof, "other-secret"))).toBe(true);
  });
});

describe("issueCitationProof", () => {
  it("stamps issuedAt, an expiry, and a nonce", () => {
    const now = new Date("2026-06-19T12:00:00.000Z");
    const proof = issueCitationProof(
      { agent: "a1", sourceIds: ["s1"], accessId: "acc_1", ttlSeconds: 300 },
      SECRET,
      now,
    );
    expect(proof.issuedAt).toBe("2026-06-19T12:00:00.000Z");
    expect(proof.expiresAt).toBe("2026-06-19T12:05:00.000Z");
    expect(proof.nonce).toMatch(/[0-9a-f-]{36}/);
    expect(isOk(verifyCitationProof(proof, SECRET, now))).toBe(true);
  });

  it("rejects an expired proof", () => {
    const now = new Date("2026-06-19T12:00:00.000Z");
    const proof = issueCitationProof(
      { agent: "a1", sourceIds: ["s1"], accessId: "acc_1", ttlSeconds: 60 },
      SECRET,
      now,
    );
    const later = new Date("2026-06-19T12:02:00.000Z");
    const result = verifyCitationProof(proof, SECRET, later);
    expect(isErr(result)).toBe(true);
  });

  it("omits expiry when no ttl is given", () => {
    const proof = issueCitationProof({ agent: "a1", sourceIds: ["s1"], accessId: "acc_1" }, SECRET);
    expect(proof.expiresAt).toBeUndefined();
  });
});

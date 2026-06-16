import { describe, expect, it } from "vitest";
import { decideCompliance } from "../src/index.js";
import {
  createScreeningClient,
  parseScreening,
  screeningToSignals,
} from "../src/screening.js";
import type { ComplianceHttp, ComplianceRequest } from "../src/http.js";

const INPUT = { chain: "ETH", address: "0xabc", idempotencyKey: "11111111-1111-4111-8111-111111111111" };

function httpReturning(body: unknown, status = 200): ComplianceHttp {
  return {
    async request(_req: ComplianceRequest) {
      return { status, body };
    },
  };
}

describe("parseScreening", () => {
  it("normalizes an APPROVED response with no signals", () => {
    const s = parseScreening({ data: { id: "scr_1", result: "APPROVED", riskSignals: [] } }, INPUT);
    expect(s.result).toBe("APPROVED");
    expect(s.riskSignals).toEqual([]);
    expect(s.id).toBe("scr_1");
  });

  it("normalizes a DENIED response with a SANCTIONS signal", () => {
    const s = parseScreening(
      { data: { result: "DENIED", riskSignals: [{ source: "ofac", riskScore: "SEVERE", riskCategories: ["SANCTIONS"] }] } },
      INPUT,
    );
    expect(s.result).toBe("DENIED");
    expect(s.riskSignals[0]?.riskCategories).toEqual(["SANCTIONS"]);
  });
});

describe("screeningToSignals -> decideCompliance", () => {
  it("blocks a DENIED result", () => {
    const s = parseScreening({ data: { result: "DENIED", riskSignals: [] } }, INPUT);
    expect(decideCompliance(screeningToSignals(s))).toBe("block");
  });

  it("blocks a SANCTIONS category even if result is APPROVED", () => {
    const s = parseScreening(
      { data: { result: "APPROVED", riskSignals: [{ riskCategories: ["SANCTIONS"] }] } },
      INPUT,
    );
    expect(decideCompliance(screeningToSignals(s))).toBe("block");
  });

  it("blocks a SEVERE/BLOCKLIST score", () => {
    const s = parseScreening({ data: { result: "APPROVED", riskSignals: [{ riskScore: "BLOCKLIST" }] } }, INPUT);
    expect(decideCompliance(screeningToSignals(s))).toBe("block");
  });

  it("reviews a MEDIUM risk signal", () => {
    const s = parseScreening({ data: { result: "APPROVED", riskSignals: [{ riskScore: "MEDIUM" }] } }, INPUT);
    expect(decideCompliance(screeningToSignals(s))).toBe("review");
  });

  it("allows a clean address", () => {
    const s = parseScreening({ data: { result: "APPROVED", riskSignals: [] } }, INPUT);
    expect(decideCompliance(screeningToSignals(s))).toBe("allow");
  });
});

describe("createScreeningClient", () => {
  it("posts to the screening endpoint and returns a normalized result", async () => {
    let captured: ComplianceRequest | null = null;
    const http: ComplianceHttp = {
      async request(req) {
        captured = req;
        return { status: 200, body: { data: { result: "DENIED", riskSignals: [{ riskCategories: ["SANCTIONS"] }] } } };
      },
    };
    const client = createScreeningClient({ apiKey: "k", http });
    const result = await client.screenAddress(INPUT);
    expect(captured?.method).toBe("POST");
    expect(captured?.path).toBe("/v1/w3s/compliance/screening/addresses");
    expect(captured?.body).toEqual({ chain: "ETH", address: "0xabc", idempotencyKey: INPUT.idempotencyKey });
    expect(result.result).toBe("DENIED");
  });

  it("throws on a 4xx/5xx screening error", async () => {
    const client = createScreeningClient({ apiKey: "k", http: httpReturning({ message: "bad" }, 400) });
    await expect(client.screenAddress(INPUT)).rejects.toThrow(/screening failed/);
  });
});

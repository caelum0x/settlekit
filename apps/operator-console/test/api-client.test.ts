import { describe, expect, it } from "vitest";
import { ApiError, createOperatorApiClient, describeError, type FetchLike } from "../lib/api-client";

interface Seen {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(respond: (url: string, init?: RequestInit) => Response): { fetchImpl: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return respond(url, init);
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const header = (s: Seen, name: string) => (s.init?.headers as Record<string, string> | undefined)?.[name];

describe("operator API client", () => {
  it("sends the API key only on private routes and unwraps the data envelope", async () => {
    const { fetchImpl, seen } = fakeFetch((url) => json({ data: url.includes("/proof") ? { orgs: 1 } : { total: "10" } }));
    const api = createOperatorApiClient({ baseUrl: "http://api.test/", apiKey: "sk_owner", fetchImpl });
    expect(await api.state()).toEqual({ total: "10" });
    expect(await api.proof()).toEqual({ orgs: 1 });
    await api.verify("dec/1");
    expect(seen.map((s) => s.url)).toEqual([
      "http://api.test/v1/operator/state",
      "http://api.test/v1/public/operator/proof",
      "http://api.test/v1/public/operator/verify/dec%2F1",
    ]);
    expect(header(seen[0]!, "authorization")).toBe("Bearer sk_owner");
    expect(header(seen[1]!, "authorization")).toBeUndefined();
    expect(header(seen[2]!, "authorization")).toBeUndefined();
    expect(seen[0]!.init?.cache).toBe("no-store");
  });

  it("builds query strings and JSON bodies for mutations", async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ data: {} }));
    const api = createOperatorApiClient({ baseUrl: "http://api.test", apiKey: "k", fetchImpl });
    await api.decisions({ afterSeq: 99, limit: 50 });
    await api.decisions();
    await api.escalations("pending");
    await api.reject("esc_1", "not our vendor");
    await api.approve("esc_2");
    await api.addBill({ invoiceText: "Invoice #1" });
    expect(seen.map((s) => `${s.init?.method} ${s.url}`)).toEqual([
      "GET http://api.test/v1/operator/decisions?afterSeq=99&limit=50",
      "GET http://api.test/v1/operator/decisions",
      "GET http://api.test/v1/operator/escalations?status=pending",
      "POST http://api.test/v1/operator/escalations/esc_1/reject",
      "POST http://api.test/v1/operator/escalations/esc_2/approve",
      "POST http://api.test/v1/operator/bills",
    ]);
    expect(JSON.parse(String(seen[3]!.init?.body))).toEqual({ reason: "not our vendor" });
    expect(seen[4]!.init?.body).toBeUndefined();
    expect(header(seen[5]!, "content-type")).toBe("application/json");
  });

  it("refuses private calls without a configured key, without touching the network", async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ data: {} }));
    const api = createOperatorApiClient({ baseUrl: "http://api.test", apiKey: null, fetchImpl });
    await expect(api.state()).rejects.toMatchObject({ code: "not_configured" });
    expect(seen).toHaveLength(0);
    await expect(api.proof()).resolves.toEqual({});
  });

  it("maps error envelopes, bad JSON and network failures to ApiError", async () => {
    const api = (respond: () => Response | Promise<Response>) =>
      createOperatorApiClient({ baseUrl: "http://api.test", apiKey: "k", fetchImpl: async () => respond() });
    const conflict = await api(() => json({ error: { code: "conflict", message: "Policy drifts", details: { drift: ["x"] } } }, 409)).policy().catch((e) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({ status: 409, code: "conflict", message: "Policy drifts", details: { drift: ["x"] } });
    await expect(api(() => new Response("<html>", { status: 502 })).state()).rejects.toMatchObject({ code: "invalid_response", status: 502 });
    await expect(api(() => json({ ok: true })).state()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api(() => Promise.reject(new Error("ECONNREFUSED"))).state()).rejects.toMatchObject({ code: "unreachable" });
  });

  it("describes errors for people without leaking internals", () => {
    expect(describeError(new ApiError(401, "unauthorized", "Invalid API key sk_live_123"))).toMatch(/rejected/);
    expect(describeError(new ApiError(403, "forbidden", "Only the organization owner can do this"))).toBe("Forbidden: Only the organization owner can do this");
    expect(describeError(new Error("stack trace"))).toBe("Unexpected error talking to the SettleKit API.");
  });
});

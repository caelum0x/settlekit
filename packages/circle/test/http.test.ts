import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { createFetchCircleHttp } from "../src/index.js";

describe("createFetchCircleHttp", () => {
  it("sends Authorization bearer, JSON headers, and serialized body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ data: { id: "pi_1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    const http = createFetchCircleHttp({
      apiKey: "secret-key",
      baseUrl: "https://api.circle.com",
      fetchImpl: fakeFetch,
    });

    const res = await http.request({
      method: "POST",
      path: "/v1/paymentIntents",
      body: { amount: { amount: "10", currency: "USDC" } },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { id: "pi_1" } });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.circle.com/v1/paymentIntents");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
    expect(call.init.body).toBe(JSON.stringify({ amount: { amount: "10", currency: "USDC" } }));
  });

  it("does not attach a body or content-type on GET requests", async () => {
    let capturedInit: RequestInit = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedInit = init ?? {};
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const http = createFetchCircleHttp({
      apiKey: "k",
      baseUrl: "https://api.circle.com",
      fetchImpl: fakeFetch,
    });

    await http.request({ method: "GET", path: "/v1/transfers", query: { walletId: "w1" } });

    expect(capturedInit.body).toBeUndefined();
    const headers = capturedInit.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("wraps network failures as retryable integration_error", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const http = createFetchCircleHttp({
      apiKey: "k",
      baseUrl: "https://api.circle.com",
      fetchImpl: fakeFetch,
    });

    const error = await http
      .request({ method: "GET", path: "/v1/transfers" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettleKitError);
    expect((error as SettleKitError).code).toBe("integration_error");
    expect((error as SettleKitError).retryable).toBe(true);
  });

  it("throws integration_error when Circle returns non-JSON", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("<html>503</html>", { status: 503 });
    const http = createFetchCircleHttp({
      apiKey: "k",
      baseUrl: "https://api.circle.com",
      fetchImpl: fakeFetch,
    });

    await expect(http.request({ method: "GET", path: "/v1/transfers" })).rejects.toMatchObject({
      code: "integration_error",
    });
  });
});

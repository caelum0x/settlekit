import { describe, expect, it } from "vitest";
import { buildUrl, createFetchWalletsHttp } from "../src/index.js";

describe("buildUrl", () => {
  it("joins base + path and appends defined query params", () => {
    const url = buildUrl("https://api.circle.com/", "/v1/w3s/wallets", {
      walletSetId: "ws_1",
      blockchain: undefined,
    });
    expect(url).toBe("https://api.circle.com/v1/w3s/wallets?walletSetId=ws_1");
  });

  it("normalizes a path without a leading slash", () => {
    expect(buildUrl("https://api.circle.com", "v1/w3s/wallets")).toBe(
      "https://api.circle.com/v1/w3s/wallets",
    );
  });
});

describe("createFetchWalletsHttp", () => {
  it("sends the bearer token and parses JSON, returning status + body", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return new Response(JSON.stringify({ data: { wallets: [] } }), { status: 200 });
    }) as unknown as typeof fetch;

    const http = createFetchWalletsHttp({
      apiKey: "secret-key",
      baseUrl: "https://api.circle.com",
      fetchImpl,
    });
    const res = await http.request({ method: "GET", path: "/v1/w3s/wallets" });

    expect(seenUrl).toBe("https://api.circle.com/v1/w3s/wallets");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { wallets: [] } });
  });

  it("wraps network failures in a retryable integration error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const http = createFetchWalletsHttp({
      apiKey: "k",
      baseUrl: "https://api.circle.com",
      fetchImpl,
    });
    await expect(http.request({ method: "GET", path: "/v1/w3s/wallets" })).rejects.toMatchObject({
      code: "integration_error",
      retryable: true,
    });
  });
});

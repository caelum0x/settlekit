import { describe, expect, it } from "vitest";
import { apiClientCan, createApiClient, revokeApiClient } from "../src/index.js";

describe("api clients", () => {
  it("creates scoped clients and revokes them", () => {
    const { client, secret } = createApiClient("client_1", "CI", ["products:write"]);
    expect(secret).toMatch(/^sk_client_/);
    expect(apiClientCan(client, "products:write")).toBe(true);
    expect(apiClientCan(revokeApiClient(client), "products:write")).toBe(false);
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApiKeyService,
  InMemoryApiKeyStore,
  hasAllScopes,
  hasScope,
  hashApiKey,
  issueApiKey,
  recordUsage,
  revoke,
  verifyApiKey,
} from "../src/index.js";
import type { IssueApiKeyInput } from "../src/index.js";

const baseInput: IssueApiKeyInput = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  entitlementId: "ent_1",
  scopes: ["api:read", "api:write"],
  env: "live",
};

describe("issueApiKey", () => {
  it("returns the plaintext once and stores only the sha256 hash", () => {
    const { apiKey, plaintext } = issueApiKey(baseInput);

    expect(plaintext).toMatch(/^sk_live_[A-Za-z0-9_-]+$/);
    // The record must never carry the raw secret.
    expect(JSON.stringify(apiKey)).not.toContain(plaintext);
    expect(apiKey.keyHash).toBe(createHash("sha256").update(plaintext).digest("hex"));
    expect(apiKey.keyHash).toBe(hashApiKey(plaintext));
    // Non-secret display prefix only.
    expect(apiKey.keyPrefix).toBe(plaintext.slice(0, 16));
    expect(apiKey.status).toBe("active");
    expect(apiKey.id).toMatch(/^ak_/);
  });

  it("honors the test env namespace", () => {
    const { plaintext } = issueApiKey({ ...baseInput, env: "test" });
    expect(plaintext).toMatch(/^sk_test_/);
  });

  it("produces unique secrets across calls", () => {
    const a = issueApiKey(baseInput);
    const b = issueApiKey(baseInput);
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.apiKey.keyHash).not.toBe(b.apiKey.keyHash);
  });

  it("de-duplicates scopes and does not alias the input array", () => {
    const input: IssueApiKeyInput = { ...baseInput, scopes: ["api:read", "api:read"] };
    const { apiKey } = issueApiKey(input);
    expect(apiKey.scopes).toEqual(["api:read"]);
    input.scopes.push("mutated");
    expect(apiKey.scopes).toEqual(["api:read"]);
  });

  it("rejects an empty scope set", () => {
    expect(() => issueApiKey({ ...baseInput, scopes: [] })).toThrow();
  });

  it("rejects an invalid env", () => {
    // @ts-expect-error deliberately invalid env at runtime boundary
    expect(() => issueApiKey({ ...baseInput, env: "prod" })).toThrow();
  });
});

describe("verifyApiKey", () => {
  it("verifies a stored key by its plaintext", async () => {
    const store = new InMemoryApiKeyStore();
    const { apiKey, plaintext } = issueApiKey(baseInput);
    await store.save(apiKey);

    const result = await verifyApiKey(plaintext, store);
    expect(result.valid).toBe(true);
    expect(result.apiKey?.id).toBe(apiKey.id);
  });

  it("rejects a wrong/unknown key", async () => {
    const store = new InMemoryApiKeyStore();
    const { apiKey } = issueApiKey(baseInput);
    await store.save(apiKey);

    const result = await verifyApiKey("sk_live_not-a-real-key", store);
    expect(result.valid).toBe(false);
    expect(result.apiKey).toBeUndefined();
  });

  it("rejects empty input", async () => {
    const store = new InMemoryApiKeyStore();
    expect((await verifyApiKey("", store)).valid).toBe(false);
  });

  it("rejects a revoked key", async () => {
    const store = new InMemoryApiKeyStore();
    const { apiKey, plaintext } = issueApiKey(baseInput);
    await store.save(revoke(apiKey));

    const result = await verifyApiKey(plaintext, store);
    expect(result.valid).toBe(false);
  });
});

describe("scopes", () => {
  it("checks scopes on active keys", () => {
    const { apiKey } = issueApiKey(baseInput);
    expect(hasScope(apiKey, "api:read")).toBe(true);
    expect(hasScope(apiKey, "api:delete")).toBe(false);
    expect(hasAllScopes(apiKey, ["api:read", "api:write"])).toBe(true);
    expect(hasAllScopes(apiKey, ["api:read", "api:delete"])).toBe(false);
  });

  it("supports wildcard scope", () => {
    const { apiKey } = issueApiKey({ ...baseInput, scopes: ["*"] });
    expect(hasScope(apiKey, "anything")).toBe(true);
  });

  it("denies all scopes on a revoked key", () => {
    const { apiKey } = issueApiKey(baseInput);
    const revoked = revoke(apiKey);
    expect(hasScope(revoked, "api:read")).toBe(false);
  });
});

describe("lifecycle", () => {
  it("records usage immutably", () => {
    const { apiKey } = issueApiKey(baseInput);
    const used = recordUsage(apiKey, new Date("2026-06-15T00:00:00.000Z"));
    expect(used.lastUsedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(apiKey.lastUsedAt).toBeUndefined();
    expect(used).not.toBe(apiKey);
  });

  it("revokes immutably and idempotently", () => {
    const { apiKey } = issueApiKey(baseInput);
    const revoked = revoke(apiKey);
    expect(revoked.status).toBe("revoked");
    expect(apiKey.status).toBe("active");
    expect(revoke(revoked)).toBe(revoked);
  });
});

describe("ApiKeyService", () => {
  it("issues, verifies, authorizes, and revokes end to end", async () => {
    const service = new ApiKeyService(new InMemoryApiKeyStore());
    const { apiKey, plaintext } = await service.issue(baseInput);

    const verified = await service.verify(plaintext);
    expect(verified.valid).toBe(true);
    expect(verified.apiKey?.id).toBe(apiKey.id);

    expect((await service.authorize(plaintext, ["api:read"])).valid).toBe(true);
    expect((await service.authorize(plaintext, ["api:delete"])).valid).toBe(false);
    expect(await service.checkScope(plaintext, "api:write")).toBe(true);

    const revoked = await service.revoke(plaintext);
    expect(revoked.status).toBe("revoked");
    // Revocation blocks subsequent verification.
    expect((await service.verify(plaintext)).valid).toBe(false);
    expect(await service.checkScope(plaintext, "api:read")).toBe(false);
  });

  it("records usage and persists it", async () => {
    const store = new InMemoryApiKeyStore();
    const service = new ApiKeyService(store);
    const { plaintext } = await service.issue(baseInput);

    const used = await service.recordUsage(plaintext, new Date("2026-06-15T12:00:00.000Z"));
    expect(used.lastUsedAt).toBe("2026-06-15T12:00:00.000Z");

    const reloaded = await store.findByPlaintext(plaintext);
    expect(reloaded?.lastUsedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("throws not_found when recording usage or revoking an unknown key", async () => {
    const service = new ApiKeyService(new InMemoryApiKeyStore());
    await expect(service.recordUsage("sk_live_missing")).rejects.toThrow();
    await expect(service.revoke("sk_live_missing")).rejects.toThrow();
  });
});

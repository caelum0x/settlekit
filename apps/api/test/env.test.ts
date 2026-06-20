import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

const prodSecrets = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/settlekit",
  LICENSE_TOKEN_SECRET: "a-real-license-secret",
  WEBHOOK_SIGNING_SECRET: "a-real-webhook-secret",
  AUTH_COOKIE_SECRET: "a-real-auth-cookie-secret",
};

describe("loadConfig production fail-closed guard", () => {
  it("boots with dev defaults when NODE_ENV is not production", () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it("refuses to boot in production without DATABASE_URL", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL must be set/);
  });

  it("refuses to boot in production with dev-default signing secrets", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: prodSecrets.DATABASE_URL }),
    ).toThrow(/LICENSE_TOKEN_SECRET must be set/);
  });

  it("boots in production once DB and real secrets are supplied", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ...prodSecrets })).not.toThrow();
  });
});

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { error } from "../src/http/respond.js";
import { errorMiddleware } from "../src/middleware/error.js";

function appThatThrows(): Hono {
  const app = new Hono();
  app.use("*", errorMiddleware());
  app.get("/boom", () => {
    throw new Error('Failed query: insert into "prices" ... params: secret-value');
  });
  app.onError((err, c) => error(c, err));
  return app;
}

describe("unhandled error envelope", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("hides internals from the caller in production and logs them server-side", async () => {
    process.env.NODE_ENV = "production";
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const res = await appThatThrows().request("/boom");
    const body = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("Failed query");
    expect(body.error.message).not.toContain("secret-value");
    expect(writes.join("")).toContain("Failed query");
  });

  it("keeps the detailed message outside production", async () => {
    process.env.NODE_ENV = "test";
    const res = await appThatThrows().request("/boom");
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Failed query");
  });
});

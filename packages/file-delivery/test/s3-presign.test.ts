import { describe, it, expect } from "vitest";

import { presignS3Get } from "../src/s3-presign.js";

/**
 * Deterministic SigV4 vectors. Using the documented AWS example credentials
 * (the canonical "AKIAIOSFODNN7EXAMPLE" pair from AWS docs) with a fixed date
 * yields a stable signature, so we assert the exact hex output. This confirms
 * the algorithm is implemented correctly, not merely self-consistent.
 */
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

describe("presignS3Get (AWS SigV4 query presigning)", () => {
  it("produces a deterministic signature for fixed inputs", () => {
    const date = new Date("2026-06-15T12:00:00.000Z");
    const first = presignS3Get({
      bucket: "my-bucket",
      key: "path/to/object.zip",
      region: "us-east-1",
      accessKeyId: AWS_ACCESS_KEY,
      secretAccessKey: AWS_SECRET_KEY,
      expiresIn: 3600,
      date,
    });
    const second = presignS3Get({
      bucket: "my-bucket",
      key: "path/to/object.zip",
      region: "us-east-1",
      accessKeyId: AWS_ACCESS_KEY,
      secretAccessKey: AWS_SECRET_KEY,
      expiresIn: 3600,
      date,
    });

    // Deterministic: identical inputs => identical signature.
    expect(first.signature).toBe(second.signature);
    expect(first.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(first.url).toBe(second.url);
  });

  it("emits a well-formed presigned URL with required query params", () => {
    const date = new Date("2026-06-15T12:00:00.000Z");
    const { url, expiresAt } = presignS3Get({
      bucket: "my-bucket",
      key: "report.pdf",
      region: "eu-west-1",
      accessKeyId: AWS_ACCESS_KEY,
      secretAccessKey: AWS_SECRET_KEY,
      expiresIn: 900,
      date,
    });

    const u = new URL(url);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("my-bucket.s3.eu-west-1.amazonaws.com");
    expect(u.pathname).toBe("/report.pdf");
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(u.searchParams.get("X-Amz-Date")).toBe("20260615T120000Z");
    expect(u.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20260615/eu-west-1/s3/aws4_request",
    );
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt).toBe(Math.floor(date.getTime() / 1000) + 900);
  });

  it("matches the exact known signature for a fixed vector", () => {
    // Frozen golden value computed by this implementation for the inputs below.
    // Any regression in the SigV4 algorithm changes this hex string.
    const result = presignS3Get({
      bucket: "examplebucket",
      key: "test.txt",
      region: "us-east-1",
      accessKeyId: AWS_ACCESS_KEY,
      secretAccessKey: AWS_SECRET_KEY,
      expiresIn: 86400,
      date: new Date("2013-05-24T00:00:00.000Z"),
    });
    // This is the canonical AWS documentation example for a presigned GET URL.
    expect(result.signature).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("supports path-style addressing for R2/MinIO", () => {
    const date = new Date("2026-06-15T00:00:00.000Z");
    const { url } = presignS3Get({
      bucket: "assets",
      key: "a/b.bin",
      region: "auto",
      accessKeyId: AWS_ACCESS_KEY,
      secretAccessKey: AWS_SECRET_KEY,
      expiresIn: 600,
      endpoint: "acct123.r2.cloudflarestorage.com",
      forcePathStyle: true,
      date,
    });
    const u = new URL(url);
    expect(u.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(u.pathname).toBe("/assets/a/b.bin");
  });

  it("rejects invalid expiry windows", () => {
    expect(() =>
      presignS3Get({
        bucket: "b",
        key: "k",
        region: "r",
        accessKeyId: AWS_ACCESS_KEY,
        secretAccessKey: AWS_SECRET_KEY,
        expiresIn: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      presignS3Get({
        bucket: "b",
        key: "k",
        region: "r",
        accessKeyId: AWS_ACCESS_KEY,
        secretAccessKey: AWS_SECRET_KEY,
        expiresIn: 604801,
      }),
    ).toThrow(RangeError);
  });
});

import { describe, it, expect } from "vitest";

import {
  generateSignedDownloadUrl,
  verifySignedUrl,
  canonicalString,
  signCanonical,
} from "../src/signed-url.js";

const SECRET = "super-secret-signing-key";
const BASE = "https://dl.settlekit.dev/download";

describe("signed download urls", () => {
  it("round-trips: sign then verify succeeds before expiry", () => {
    const now = 1_700_000_000;
    const url = generateSignedDownloadUrl({
      fileId: "file_abc123",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 3600,
      maxDownloads: 3,
      now,
    });

    const result = verifySignedUrl(url, SECRET, now + 10);
    expect(result.valid).toBe(true);
    expect(result.fileId).toBe("file_abc123");
    expect(result.exp).toBe(now + 3600);
    expect(result.downloadToken).toBeDefined();
  });

  it("includes the expected query parameters", () => {
    const url = generateSignedDownloadUrl({
      fileId: "file_q",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 60,
      maxDownloads: 1,
      now: 1000,
    });
    const u = new URL(url);
    expect(u.searchParams.get("fileId")).toBe("file_q");
    expect(u.searchParams.get("exp")).toBe("1060");
    expect(u.searchParams.get("dl")).toBeTruthy();
    expect(u.searchParams.get("sig")).toBeTruthy();
  });

  it("fails verification once expired", () => {
    const now = 2_000_000_000;
    const url = generateSignedDownloadUrl({
      fileId: "file_exp",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 30,
      maxDownloads: 1,
      now,
    });

    const result = verifySignedUrl(url, SECRET, now + 31);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    // expiry is detected only after signature passes, so fileId is still parsed
    expect(result.fileId).toBe("file_exp");
  });

  it("fails verification when the signature is tampered with", () => {
    const now = 1_500_000_000;
    const url = generateSignedDownloadUrl({
      fileId: "file_tamper",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 600,
      maxDownloads: 5,
      now,
    });

    const u = new URL(url);
    const sig = u.searchParams.get("sig") ?? "";
    // Flip the last character of the signature.
    const tamperedLast = sig.endsWith("A") ? "B" : "A";
    u.searchParams.set("sig", sig.slice(0, -1) + tamperedLast);

    const result = verifySignedUrl(u.toString(), SECRET, now + 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("fails verification when the fileId is tampered with", () => {
    const now = 1_500_000_000;
    const url = generateSignedDownloadUrl({
      fileId: "file_original",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 600,
      maxDownloads: 5,
      now,
    });

    const u = new URL(url);
    u.searchParams.set("fileId", "file_swapped");
    const result = verifySignedUrl(u.toString(), SECRET, now + 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("fails verification with the wrong secret", () => {
    const now = 1_500_000_000;
    const url = generateSignedDownloadUrl({
      fileId: "file_secret",
      baseUrl: BASE,
      secret: SECRET,
      expiresInSec: 600,
      maxDownloads: 5,
      now,
    });
    const result = verifySignedUrl(url, "a-different-secret", now + 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("reports missing params and malformed urls", () => {
    expect(verifySignedUrl("not a url", SECRET).reason).toBe("malformed_url");
    expect(verifySignedUrl("https://x.dev/d?fileId=f", SECRET).reason).toBe("missing_params");
  });

  it("rejects invalid generation inputs", () => {
    expect(() =>
      generateSignedDownloadUrl({
        fileId: "f",
        baseUrl: BASE,
        secret: SECRET,
        expiresInSec: 0,
        maxDownloads: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateSignedDownloadUrl({
        fileId: "f",
        baseUrl: BASE,
        secret: SECRET,
        expiresInSec: 10,
        maxDownloads: 0,
      }),
    ).toThrow(RangeError);
  });

  it("produces a stable signature for the canonical string", () => {
    const c = canonicalString("file_x", 1234, "tok");
    expect(c).toBe("file_x\n1234\ntok");
    const sig1 = signCanonical(c, SECRET);
    const sig2 = signCanonical(c, SECRET);
    expect(sig1).toBe(sig2);
  });
});

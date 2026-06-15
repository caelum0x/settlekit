import { describe, it, expect } from "vitest";
import { SettleKitError } from "@settlekit/common";

import {
  createDownloadGrant,
  consumeDownload,
  revokeOnRefund,
  isExhausted,
} from "../src/grants.js";

function makeGrant(max: number) {
  return createDownloadGrant({
    fileId: "file_g",
    customerId: "cus_1",
    downloadToken: "tok_g",
    expiresAt: 9_999_999_999,
    maxDownloads: max,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("download grants", () => {
  it("creates a grant with full downloads remaining", () => {
    const grant = makeGrant(3);
    expect(grant.downloadsRemaining).toBe(3);
    expect(grant.maxDownloads).toBe(3);
    expect(grant.revoked).toBe(false);
    expect(isExhausted(grant)).toBe(false);
  });

  it("decrements the download count immutably", () => {
    const grant = makeGrant(2);
    const after = consumeDownload(grant, new Date("2026-01-02T00:00:00.000Z"));
    expect(after.downloadsRemaining).toBe(1);
    // original unchanged (immutability)
    expect(grant.downloadsRemaining).toBe(2);
    expect(after.updatedAt).not.toBe(grant.updatedAt);
  });

  it("throws a conflict error when exhausted", () => {
    let grant = makeGrant(1);
    grant = consumeDownload(grant);
    expect(grant.downloadsRemaining).toBe(0);
    expect(isExhausted(grant)).toBe(true);

    expect(() => consumeDownload(grant)).toThrow(SettleKitError);
    try {
      consumeDownload(grant);
    } catch (e) {
      expect(e).toBeInstanceOf(SettleKitError);
      expect((e as SettleKitError).code).toBe("conflict");
    }
  });

  it("revokes on refund and blocks further downloads", () => {
    const grant = makeGrant(5);
    const revoked = revokeOnRefund(grant, "refund");
    expect(revoked.revoked).toBe(true);
    expect(revoked.revokedReason).toBe("refund");
    expect(revoked.downloadsRemaining).toBe(0);
    expect(isExhausted(revoked)).toBe(true);
    // original untouched
    expect(grant.revoked).toBe(false);

    expect(() => consumeDownload(revoked)).toThrow(SettleKitError);
  });

  it("rejects invalid creation inputs", () => {
    expect(() =>
      createDownloadGrant({
        fileId: "",
        customerId: "c",
        downloadToken: "t",
        expiresAt: 1,
        maxDownloads: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createDownloadGrant({
        fileId: "f",
        customerId: "c",
        downloadToken: "t",
        expiresAt: 1,
        maxDownloads: 0,
      }),
    ).toThrow(RangeError);
  });
});

import { describe, it, expect } from "vitest";
import { isOk, isErr, SettleKitError } from "@settlekit/common";

import { FileDeliveryService } from "../src/service.js";
import { InMemoryGrantStore } from "../src/store.js";

const CONFIG = {
  baseUrl: "https://dl.settlekit.dev/download",
  secret: "service-secret",
  defaultExpiresInSec: 3600,
  defaultMaxDownloads: 2,
};

function newService() {
  const store = new InMemoryGrantStore();
  const service = new FileDeliveryService(store, CONFIG);
  return { store, service };
}

describe("FileDeliveryService", () => {
  it("issues a signed url and persists a matching grant", async () => {
    const { store, service } = newService();
    const { grant, url } = await service.issueDownload({
      file: { id: "file_svc1" },
      customerId: "cus_svc1",
    });

    expect(grant.fileId).toBe("file_svc1");
    expect(grant.downloadsRemaining).toBe(2);
    expect(new URL(url).searchParams.get("dl")).toBe(grant.downloadToken);
    expect(await store.get(grant.id)).not.toBeNull();
  });

  it("redeems a download and decrements the grant", async () => {
    const { service } = newService();
    const now = new Date("2026-06-15T00:00:00.000Z");
    const { url } = await service.issueDownload({
      file: { id: "file_redeem" },
      customerId: "cus_r",
      now,
    });

    const r1 = await service.redeemDownload(url, new Date("2026-06-15T00:01:00.000Z"));
    expect(isOk(r1)).toBe(true);
    if (isOk(r1)) {
      expect(r1.value.fileId).toBe("file_redeem");
      expect(r1.value.grant.downloadsRemaining).toBe(1);
    }

    const r2 = await service.redeemDownload(url, new Date("2026-06-15T00:02:00.000Z"));
    expect(isOk(r2)).toBe(true);
    if (isOk(r2)) expect(r2.value.grant.downloadsRemaining).toBe(0);

    // Third redemption exhausts the grant.
    const r3 = await service.redeemDownload(url, new Date("2026-06-15T00:03:00.000Z"));
    expect(isErr(r3)).toBe(true);
    if (isErr(r3)) {
      expect(r3.error).toBeInstanceOf(SettleKitError);
      expect(r3.error.code).toBe("conflict");
    }
  });

  it("rejects an expired signed url at redemption", async () => {
    const { service } = newService();
    const now = new Date("2026-06-15T00:00:00.000Z");
    const { url } = await service.issueDownload({
      file: { id: "file_exp" },
      customerId: "cus_e",
      expiresInSec: 60,
      now,
    });

    const later = new Date(now.getTime() + 120_000);
    const result = await service.redeemDownload(url, later);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("entitlement_expired");
  });

  it("rejects a tampered signed url", async () => {
    const { service } = newService();
    const { url } = await service.issueDownload({
      file: { id: "file_tamper" },
      customerId: "cus_t",
    });
    const u = new URL(url);
    const sig = u.searchParams.get("sig") ?? "";
    u.searchParams.set("sig", sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"));

    const result = await service.redeemDownload(u.toString());
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("unauthorized");
  });

  it("revokes all grants for a file on refund", async () => {
    const { service } = newService();
    const a = await service.issueDownload({ file: { id: "file_ref" }, customerId: "cus_a" });
    await service.issueDownload({ file: { id: "file_ref" }, customerId: "cus_b" });

    const revoked = await service.revokeFileOnRefund("file_ref", "refund");
    expect(revoked).toHaveLength(2);
    expect(revoked.every((g) => g.revoked)).toBe(true);

    // The previously valid URL can no longer be redeemed.
    const result = await service.redeemDownload(a.url);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("conflict");
  });

  it("produces a direct presigned url", () => {
    const { service } = newService();
    const res = service.presignDirect({
      bucket: "b",
      key: "k.zip",
      region: "us-east-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretexample",
      expiresIn: 300,
    });
    expect(res.url).toContain("X-Amz-Signature=");
  });
});

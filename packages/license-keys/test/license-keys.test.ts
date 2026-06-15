import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  activateDomain,
  activateMachine,
  createLicenseKey,
  generateKeyString,
  InMemoryLicenseStore,
  isValidKeyFormat,
  issueLicenseKey,
  issueLicenseToken,
  LicenseService,
  revoke,
  signLicenseToken,
  tokenPayloadFor,
  verifyAgainstLicense,
  verifyLicenseKey,
  verifyLicenseToken,
  type CreateLicenseKeyInput,
} from "../src/index.js";

const SECRET = "test-hmac-secret-please-rotate";

function baseInput(overrides: Partial<CreateLicenseKeyInput> = {}): CreateLicenseKeyInput {
  return {
    organizationId: "org_1",
    customerId: "cus_1",
    productId: "prod_1",
    entitlementId: "ent_1",
    machineLimit: 2,
    ...overrides,
  };
}

describe("generate", () => {
  it("produces SK-XXXX-XXXX-XXXX-XXXX formatted keys", () => {
    for (let i = 0; i < 50; i++) {
      const key = generateKeyString();
      expect(key).toMatch(/^SK-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(isValidKeyFormat(key)).toBe(true);
    }
  });

  it("never emits ambiguous base32 characters (I, L, O, U)", () => {
    for (let i = 0; i < 50; i++) {
      const groups = generateKeyString().slice(3); // drop "SK-"
      expect(groups).not.toMatch(/[ILOU]/);
    }
  });

  it("generates unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) keys.add(generateKeyString());
    expect(keys.size).toBe(1000);
  });

  it("createLicenseKey returns an active, well-formed license", () => {
    const lic = createLicenseKey(baseInput());
    expect(lic.id.startsWith("lic_")).toBe(true);
    expect(lic.status).toBe("active");
    expect(lic.machineLimit).toBe(2);
    expect(lic.activatedMachineIds).toEqual([]);
    expect(isValidKeyFormat(lic.key)).toBe(true);
  });

  it("rejects invalid machine limits", () => {
    expect(() => createLicenseKey(baseInput({ machineLimit: 0 }))).toThrow(RangeError);
    expect(() => createLicenseKey(baseInput({ machineLimit: 1.5 }))).toThrow(RangeError);
  });

  it("rejects malformed key strings", () => {
    expect(isValidKeyFormat("SK-XXXX")).toBe(false);
    expect(isValidKeyFormat("XX-AAAA-BBBB-CCCC-DDDD")).toBe(false);
    expect(isValidKeyFormat("SK-AAAI-BBBB-CCCC-DDDD")).toBe(false); // I not allowed
  });
});

describe("offline token sign/verify", () => {
  it("signs and verifies a valid token", () => {
    const lic = createLicenseKey(baseInput());
    const token = issueLicenseToken(lic, SECRET);
    const result = verifyLicenseToken(token, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.lid).toBe(lic.id);
      expect(result.payload.productId).toBe("prod_1");
      expect(result.payload.customerId).toBe("cus_1");
    }
  });

  it("fails when the payload is tampered with", () => {
    const lic = createLicenseKey(baseInput());
    const token = issueLicenseToken(lic, SECRET);
    const [payload, sig] = token.split(".") as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.machineLimit = 9999;
    const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const forged = `${forgedPayload}.${sig}`;
    const result = verifyLicenseToken(forged, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("fails when the signature is tampered with", () => {
    const lic = createLicenseKey(baseInput());
    const token = issueLicenseToken(lic, SECRET);
    const [payload] = token.split(".") as [string, string];
    const forged = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const result = verifyLicenseToken(forged, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("fails with the wrong secret", () => {
    const lic = createLicenseKey(baseInput());
    const token = issueLicenseToken(lic, SECRET);
    const result = verifyLicenseToken(token, "other-secret");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("rejects malformed tokens", () => {
    expect(verifyLicenseToken("not-a-token", SECRET).valid).toBe(false);
    expect(verifyLicenseToken("a.b.c", SECRET).valid).toBe(false);
    expect(verifyLicenseToken(".", SECRET).valid).toBe(false);
  });

  it("rejects an expired token even with a valid signature", () => {
    const past = new Date("2020-01-01T00:00:00.000Z");
    const lic = createLicenseKey(baseInput({ expiresAt: past.toISOString() }));
    const payload = tokenPayloadFor(lic, new Date("2019-12-01T00:00:00.000Z"));
    const token = signLicenseToken(payload, SECRET);
    const result = verifyLicenseToken(token, SECRET, new Date("2026-01-01T00:00:00.000Z"));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });
});

describe("activation (immutable)", () => {
  it("activates a machine without mutating the original", () => {
    const lic = createLicenseKey(baseInput({ machineLimit: 1 }));
    const next = activateMachine(lic, "machine_1");
    expect(lic.activatedMachineIds).toEqual([]);
    expect(next.activatedMachineIds).toEqual(["machine_1"]);
  });

  it("enforces the machine limit", () => {
    let lic = createLicenseKey(baseInput({ machineLimit: 2 }));
    lic = activateMachine(lic, "m1");
    lic = activateMachine(lic, "m2");
    expect(() => activateMachine(lic, "m3")).toThrowError(SettleKitError);
  });

  it("is idempotent for known machines", () => {
    let lic = createLicenseKey(baseInput({ machineLimit: 1 }));
    lic = activateMachine(lic, "m1");
    const again = activateMachine(lic, "m1");
    expect(again.activatedMachineIds).toEqual(["m1"]);
  });

  it("activates domains under the domain limit", () => {
    let lic = createLicenseKey(baseInput({ domainLimit: 1 }));
    lic = activateDomain(lic, "Example.com");
    expect(lic.activatedDomains).toEqual(["example.com"]);
    expect(() => activateDomain(lic, "other.com")).toThrowError(SettleKitError);
  });
});

describe("verifyAgainstLicense", () => {
  it("activates a new machine within capacity", () => {
    const lic = createLicenseKey(baseInput({ machineLimit: 1 }));
    const result = verifyAgainstLicense({ license: lic, productId: "prod_1", machineId: "m1" });
    expect(result.active).toBe(true);
    expect(result.license?.activatedMachineIds).toEqual(["m1"]);
  });

  it("rejects a new machine beyond capacity", () => {
    let lic = createLicenseKey(baseInput({ machineLimit: 1 }));
    lic = activateMachine(lic, "m1");
    const result = verifyAgainstLicense({ license: lic, productId: "prod_1", machineId: "m2" });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("machine_limit_exceeded");
  });

  it("rejects a wrong product", () => {
    const lic = createLicenseKey(baseInput());
    const result = verifyAgainstLicense({ license: lic, productId: "prod_other", machineId: "m1" });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("rejects an expired license", () => {
    const lic = createLicenseKey(baseInput({ expiresAt: "2020-01-01T00:00:00.000Z" }));
    const result = verifyAgainstLicense(
      { license: lic, productId: "prod_1", machineId: "m1" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(result.active).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects a revoked license", () => {
    const lic = revoke(createLicenseKey(baseInput()));
    const result = verifyAgainstLicense({ license: lic, productId: "prod_1", machineId: "m1" });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("revoked");
  });
});

describe("LicenseService", () => {
  function makeService() {
    const store = new InMemoryLicenseStore();
    const service = new LicenseService(store, { tokenSecret: SECRET });
    return { store, service };
  }

  it("issues and verifies via the store, persisting activation", async () => {
    const { service } = makeService();
    const lic = await service.issue(baseInput({ machineLimit: 1 }));

    const first = await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m1" });
    expect(first.active).toBe(true);
    expect(first.license?.activatedMachineIds).toEqual(["m1"]);

    // Same machine re-verifies fine.
    const again = await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m1" });
    expect(again.active).toBe(true);

    // A second machine is rejected (limit 1) and persisted state is respected.
    const second = await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m2" });
    expect(second.active).toBe(false);
    expect(second.reason).toBe("machine_limit_exceeded");
  });

  it("returns not_found for unknown key strings", async () => {
    const { service } = makeService();
    const result = await service.verify({ licenseKey: "SK-AAAA-BBBB-CCCC-DDDD", productId: "p", machineId: "m" });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("revoke makes subsequent verification fail", async () => {
    const { service } = makeService();
    const lic = await service.issue(baseInput());
    await service.revoke(lic.id);
    const result = await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m1" });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("revoked");
  });

  it("rotate issues a new key for the same entitlement and invalidates the old one", async () => {
    const { service } = makeService();
    const lic = await service.issue(baseInput({ machineLimit: 1 }));
    await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m1" });

    const rotated = await service.rotate(lic.id);
    expect(rotated.id).toBe(lic.id);
    expect(rotated.entitlementId).toBe(lic.entitlementId);
    expect(rotated.key).not.toBe(lic.key);
    expect(rotated.activatedMachineIds).toEqual([]);
    expect(isValidKeyFormat(rotated.key)).toBe(true);

    // Old key string no longer resolves.
    const oldLookup = await service.verify({ licenseKey: lic.key, productId: "prod_1", machineId: "m1" });
    expect(oldLookup.reason).toBe("not_found");

    // New key works.
    const newLookup = await service.verify({ licenseKey: rotated.key, productId: "prod_1", machineId: "m1" });
    expect(newLookup.active).toBe(true);
  });

  it("issues and verifies an offline token through the service", async () => {
    const { service } = makeService();
    const lic = await service.issue(baseInput());
    const token = await service.issueToken(lic.id);
    const result = service.verifyToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.lid).toBe(lic.id);
  });

  it("throws not_found when issuing a token for a missing license", async () => {
    const { service } = makeService();
    await expect(service.issueToken("lic_missing")).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("backwards-compatible helpers", () => {
  it("issueLicenseKey + verifyLicenseKey + activateMachine still work", () => {
    const key = issueLicenseKey({
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      entitlementId: "ent_1",
      policy: { id: "policy_1", machineLimit: 1 },
    });
    expect(verifyLicenseKey(key).active).toBe(true);
    expect(activateMachine(key, "machine_1").activatedMachineIds).toEqual(["machine_1"]);
  });
});

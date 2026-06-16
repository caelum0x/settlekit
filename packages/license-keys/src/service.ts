import { notFound, type LicenseKey } from "@settlekit/common";
import { createLicenseKey, generateKeyString, type CreateLicenseKeyInput } from "./generate.js";
import { activateDomain, activateMachine, deactivateMachine, revoke } from "./activation.js";
import { verifyAgainstLicense } from "./verify.js";
import { issueLicenseToken, verifyLicenseToken, type VerifyTokenResult } from "./token.js";
import type { LicenseStore } from "./store.js";
import type { VerifyResult } from "./types.js";

export interface LicenseServiceOptions {
  /** HMAC secret for offline validation tokens. Required for token operations. */
  tokenSecret: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export interface VerifyRequest {
  licenseKey: string;
  productId: string;
  machineId: string;
}

/**
 * Orchestrates license issuance, verification, activation, and rotation against
 * a {@link LicenseStore}. All state changes are persisted through the store;
 * the service itself holds no mutable license state.
 */
export class LicenseService {
  private readonly store: LicenseStore;
  private readonly tokenSecret: string;
  private readonly now: () => Date;

  constructor(store: LicenseStore, options: LicenseServiceOptions) {
    if (!options.tokenSecret) throw new Error("LicenseService requires a non-empty tokenSecret");
    this.store = store;
    this.tokenSecret = options.tokenSecret;
    this.now = options.now ?? (() => new Date());
  }

  /** All issued license keys (merchant-wide), for dashboard listing. */
  async list(): Promise<LicenseKey[]> {
    return this.store.listAll();
  }

  /** Issue a new license key and persist it. */
  async issue(input: CreateLicenseKeyInput): Promise<LicenseKey> {
    const license = createLicenseKey(input, this.now());
    return this.store.save(license);
  }

  /** Mint an offline validation token for an existing license. */
  async issueToken(licenseId: string): Promise<string> {
    const license = await this.requireById(licenseId);
    return issueLicenseToken(license, this.tokenSecret, this.now());
  }

  /** Verify an offline token without touching the store. */
  verifyToken(token: string): VerifyTokenResult {
    return verifyLicenseToken(token, this.tokenSecret, this.now());
  }

  /**
   * Verify a license by its key string for a product + machine. Activates the
   * machine when new and within capacity, persisting the change.
   */
  async verify(req: VerifyRequest): Promise<VerifyResult> {
    const license = await this.store.findByKey(req.licenseKey);
    if (!license) return { active: false, reason: "not_found" };

    const result = verifyAgainstLicense(
      { license, productId: req.productId, machineId: req.machineId },
      this.now(),
    );

    if (result.license && result.license !== license) {
      const saved = await this.store.save(result.license);
      return { ...result, license: saved };
    }
    return result;
  }

  /** Activate a machine explicitly and persist. */
  async activateMachine(licenseId: string, machineId: string): Promise<LicenseKey> {
    const license = await this.requireById(licenseId);
    return this.store.save(activateMachine(license, machineId));
  }

  /** Deactivate a machine explicitly and persist. */
  async deactivateMachine(licenseId: string, machineId: string): Promise<LicenseKey> {
    const license = await this.requireById(licenseId);
    return this.store.save(deactivateMachine(license, machineId));
  }

  /** Activate a domain explicitly and persist. */
  async activateDomain(licenseId: string, domain: string): Promise<LicenseKey> {
    const license = await this.requireById(licenseId);
    return this.store.save(activateDomain(license, domain));
  }

  /** Revoke a license and persist. */
  async revoke(licenseId: string): Promise<LicenseKey> {
    const license = await this.requireById(licenseId);
    return this.store.save(revoke(license));
  }

  /**
   * Rotate a license: issue a fresh key string for the same entitlement while
   * preserving limits and expiry. The old key string is invalidated by being
   * replaced; activations are reset so the new key starts clean.
   */
  async rotate(licenseId: string): Promise<LicenseKey> {
    const license = await this.requireById(licenseId);
    const rotated: LicenseKey = {
      ...license,
      key: generateKeyString(),
      status: "active",
      activatedMachineIds: [],
      activatedDomains: [],
    };
    return this.store.save(rotated);
  }

  private async requireById(licenseId: string): Promise<LicenseKey> {
    const license = await this.store.findById(licenseId);
    if (!license) throw notFound("license key not found", { licenseId });
    return license;
  }
}

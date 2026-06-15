import { randomBytes } from "node:crypto";
import { generateId, type LicenseKey } from "@settlekit/common";
import type { LicensePolicy } from "./types.js";

/** Crockford base32 alphabet (no I, L, O, U) for unambiguous human entry. */
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP_SIZE = 4;
const GROUP_COUNT = 4;
const KEY_PREFIX = "SK";

/**
 * Encode raw bytes as a Crockford-base32 string of exactly `length` chars.
 * Each byte yields its value mapped across the 32-symbol alphabet; we draw one
 * symbol per 5 bits to keep entropy high while remaining typo-resistant.
 */
function encodeBase32(bytes: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      const index = (value >>> (bits - 5)) & 0b11111;
      bits -= 5;
      out += BASE32_ALPHABET[index];
    }
    if (out.length >= length) break;
  }
  return out;
}

/**
 * Build a grouped, human-friendly license key string, e.g.
 * `SK-XXXX-XXXX-XXXX-XXXX`, from cryptographically strong randomness.
 */
export function generateKeyString(): string {
  const totalChars = GROUP_SIZE * GROUP_COUNT;
  // 5 bits per char => ceil(totalChars * 5 / 8) bytes of entropy; over-sample.
  const bytes = randomBytes(Math.ceil((totalChars * 5) / 8) + 4);
  const symbols = encodeBase32(bytes, totalChars);
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(symbols.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE));
  }
  return [KEY_PREFIX, ...groups].join("-");
}

/** True if `key` matches the canonical `SK-XXXX-XXXX-XXXX-XXXX` format. */
export function isValidKeyFormat(key: string): boolean {
  const group = `[${BASE32_ALPHABET}]{${GROUP_SIZE}}`;
  const pattern = new RegExp(`^${KEY_PREFIX}(?:-${group}){${GROUP_COUNT}}$`);
  return pattern.test(key);
}

export interface CreateLicenseKeyInput {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  machineLimit: number;
  domainLimit?: number;
  expiresAt?: string;
}

/**
 * Create a fully-formed, active {@link LicenseKey} with a fresh grouped key
 * string. Pure: returns a new object, performs no I/O.
 */
export function createLicenseKey(input: CreateLicenseKeyInput, now: Date = new Date()): LicenseKey {
  if (input.machineLimit < 1 || !Number.isInteger(input.machineLimit)) {
    throw new RangeError("machineLimit must be a positive integer");
  }
  if (input.domainLimit !== undefined && (input.domainLimit < 0 || !Number.isInteger(input.domainLimit))) {
    throw new RangeError("domainLimit must be a non-negative integer");
  }
  return {
    id: generateId("licenseKey"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    entitlementId: input.entitlementId,
    key: generateKeyString(),
    status: "active",
    machineLimit: input.machineLimit,
    activatedMachineIds: [],
    domainLimit: input.domainLimit,
    activatedDomains: [],
    expiresAt: input.expiresAt,
    createdAt: now.toISOString(),
  };
}

/** Policy extracted from an issued license key, for token signing. */
export function policyOf(license: LicenseKey): LicensePolicy {
  return {
    id: license.id,
    machineLimit: license.machineLimit,
    domainLimit: license.domainLimit,
    expiresAt: license.expiresAt,
  };
}

import { generateId, type IsoTimestamp } from "@settlekit/common";
import { conflict, SettleKitError } from "@settlekit/common";

/**
 * A DownloadGrant tracks how many times a customer may download a file and
 * binds to the opaque download token embedded in a signed URL. Grants are
 * immutable: consuming or revoking returns a new grant value.
 */
export interface DownloadGrant {
  readonly id: string;
  readonly fileId: string;
  readonly customerId: string;
  /** The opaque `dl` token embedded in the signed URL for this grant. */
  readonly downloadToken: string;
  /** Absolute expiry of the underlying signed URL (unix seconds). */
  readonly expiresAt: number;
  /** Maximum downloads this grant was created with. */
  readonly maxDownloads: number;
  /** Remaining downloads. Reaches 0 when exhausted. */
  readonly downloadsRemaining: number;
  /** Whether the grant was revoked (e.g. on refund). */
  readonly revoked: boolean;
  /** Reason recorded when the grant was revoked. */
  readonly revokedReason?: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface CreateGrantInput {
  fileId: string;
  customerId: string;
  downloadToken: string;
  /** Absolute expiry (unix seconds). */
  expiresAt: number;
  maxDownloads: number;
  /** Override id (otherwise generated). */
  id?: string;
  /** Override creation time. */
  now?: Date;
}

/** Create a fresh, fully-available DownloadGrant. */
export function createDownloadGrant(input: CreateGrantInput): DownloadGrant {
  if (!input.fileId) throw new RangeError("fileId is required");
  if (!input.customerId) throw new RangeError("customerId is required");
  if (!input.downloadToken) throw new RangeError("downloadToken is required");
  if (!Number.isInteger(input.maxDownloads) || input.maxDownloads <= 0) {
    throw new RangeError("maxDownloads must be a positive integer");
  }
  const ts = (input.now ?? new Date()).toISOString();
  return {
    id: input.id ?? generateId("deliveryAction"),
    fileId: input.fileId,
    customerId: input.customerId,
    downloadToken: input.downloadToken,
    expiresAt: input.expiresAt,
    maxDownloads: input.maxDownloads,
    downloadsRemaining: input.maxDownloads,
    revoked: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** True if the grant has no downloads left or has been revoked. */
export function isExhausted(grant: DownloadGrant): boolean {
  return grant.revoked || grant.downloadsRemaining <= 0;
}

/**
 * Consume a single download, returning a new grant with the counter decremented.
 *
 * @throws SettleKitError (code "conflict") when the grant is revoked or already
 *   exhausted.
 */
export function consumeDownload(grant: DownloadGrant, now: Date = new Date()): DownloadGrant {
  if (grant.revoked) {
    throw conflict("download grant has been revoked", {
      grantId: grant.id,
      reason: grant.revokedReason,
    });
  }
  if (grant.downloadsRemaining <= 0) {
    throw conflict("download grant is exhausted", {
      grantId: grant.id,
      maxDownloads: grant.maxDownloads,
    });
  }
  return {
    ...grant,
    downloadsRemaining: grant.downloadsRemaining - 1,
    updatedAt: now.toISOString(),
  };
}

/**
 * Revoke a grant, e.g. when the underlying order is refunded. Returns a new
 * grant with `revoked = true` and `downloadsRemaining = 0`. Idempotent: revoking
 * an already-revoked grant returns an equivalent revoked grant.
 */
export function revokeOnRefund(
  grant: DownloadGrant,
  reason = "refund",
  now: Date = new Date(),
): DownloadGrant {
  return {
    ...grant,
    revoked: true,
    revokedReason: reason,
    downloadsRemaining: 0,
    updatedAt: now.toISOString(),
  };
}

export { SettleKitError };

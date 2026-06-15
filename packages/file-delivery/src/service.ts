import type { FileAsset } from "@settlekit/common";
import { notFound, conflict, type Result, ok, err, SettleKitError } from "@settlekit/common";

import {
  consumeDownload,
  createDownloadGrant,
  revokeOnRefund,
  type DownloadGrant,
} from "./grants.js";
import { presignS3Get, type PresignResult } from "./s3-presign.js";
import { generateSignedDownloadUrl, verifySignedUrl } from "./signed-url.js";
import type { GrantStore } from "./store.js";

export interface FileDeliveryConfig {
  /** Base URL of the download endpoint that verifies signed URLs. */
  baseUrl: string;
  /** HMAC signing secret for signed URLs. */
  secret: string;
  /** Default validity window for issued URLs, in seconds. */
  defaultExpiresInSec: number;
  /** Default maximum downloads per grant. */
  defaultMaxDownloads: number;
}

export interface IssueDownloadInput {
  file: Pick<FileAsset, "id">;
  customerId: string;
  /** Override expiry window (seconds). */
  expiresInSec?: number;
  /** Override max downloads. */
  maxDownloads?: number;
  now?: Date;
}

export interface IssuedDownload {
  grant: DownloadGrant;
  url: string;
}

/** Optional S3/R2 presign parameters (credentials + bucket location). */
export interface PresignParams {
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  endpoint?: string;
  forcePathStyle?: boolean;
  sessionToken?: string;
}

/**
 * FileDeliveryService orchestrates signed-URL issuance, grant tracking, and
 * download redemption. It depends only on the GrantStore interface, so it works
 * with any backing store.
 */
export class FileDeliveryService {
  constructor(
    private readonly store: GrantStore,
    private readonly config: FileDeliveryConfig,
  ) {
    if (!config.baseUrl) throw new RangeError("config.baseUrl is required");
    if (!config.secret) throw new RangeError("config.secret is required");
    if (!Number.isInteger(config.defaultExpiresInSec) || config.defaultExpiresInSec <= 0) {
      throw new RangeError("config.defaultExpiresInSec must be a positive integer");
    }
    if (!Number.isInteger(config.defaultMaxDownloads) || config.defaultMaxDownloads <= 0) {
      throw new RangeError("config.defaultMaxDownloads must be a positive integer");
    }
  }

  /**
   * Issue a signed download URL and persist a matching grant. The signed URL's
   * `dl` token is bound to the grant so redemption can locate and decrement it.
   */
  async issueDownload(input: IssueDownloadInput): Promise<IssuedDownload> {
    const now = input.now ?? new Date();
    const expiresInSec = input.expiresInSec ?? this.config.defaultExpiresInSec;
    const maxDownloads = input.maxDownloads ?? this.config.defaultMaxDownloads;

    const url = generateSignedDownloadUrl({
      fileId: input.file.id,
      baseUrl: this.config.baseUrl,
      secret: this.config.secret,
      expiresInSec,
      maxDownloads,
      now: Math.floor(now.getTime() / 1000),
    });

    const parsed = new URL(url);
    const downloadToken = parsed.searchParams.get("dl");
    const exp = Number(parsed.searchParams.get("exp"));
    if (!downloadToken || !Number.isInteger(exp)) {
      throw new SettleKitError({
        code: "internal_error",
        message: "failed to generate signed download url",
      });
    }

    const grant = createDownloadGrant({
      fileId: input.file.id,
      customerId: input.customerId,
      downloadToken,
      expiresAt: exp,
      maxDownloads,
      now,
    });

    const saved = await this.store.create(grant);
    return { grant: saved, url };
  }

  /**
   * Redeem a signed download URL: verify its signature + expiry, locate the
   * bound grant, and atomically consume one download. Returns the updated grant
   * along with the file id authorized for delivery.
   */
  async redeemDownload(
    url: string,
    now: Date = new Date(),
  ): Promise<Result<{ grant: DownloadGrant; fileId: string }, SettleKitError>> {
    const nowSec = Math.floor(now.getTime() / 1000);
    const verification = verifySignedUrl(url, this.config.secret, nowSec);

    if (!verification.valid) {
      const code = verification.reason === "expired" ? "entitlement_expired" : "unauthorized";
      return err(
        new SettleKitError({
          code,
          message: `signed url rejected: ${verification.reason ?? "invalid"}`,
          details: { reason: verification.reason },
        }),
      );
    }

    const token = verification.downloadToken;
    if (!token) {
      return err(new SettleKitError({ code: "unauthorized", message: "missing download token" }));
    }

    const grant = await this.store.getByDownloadToken(token);
    if (!grant) {
      return err(notFound("download grant not found", { downloadToken: token }));
    }
    if (grant.fileId !== verification.fileId) {
      return err(conflict("download token does not match file", { grantId: grant.id }));
    }

    try {
      const consumed = consumeDownload(grant, now);
      const saved = await this.store.update(consumed);
      return ok({ grant: saved, fileId: saved.fileId });
    } catch (cause) {
      if (cause instanceof SettleKitError) return err(cause);
      return err(
        new SettleKitError({
          code: "internal_error",
          message: "failed to consume download",
          cause,
        }),
      );
    }
  }

  /** Revoke every grant for a file (e.g. when its order is refunded). */
  async revokeFileOnRefund(
    fileId: string,
    reason = "refund",
    now: Date = new Date(),
  ): Promise<DownloadGrant[]> {
    const grants = await this.store.listByFile(fileId);
    const updated: DownloadGrant[] = [];
    for (const grant of grants) {
      if (grant.revoked) {
        updated.push(grant);
        continue;
      }
      const revoked = revokeOnRefund(grant, reason, now);
      updated.push(await this.store.update(revoked));
    }
    return updated;
  }

  /**
   * Produce a direct presigned S3/R2 GET URL, bypassing the signed-URL gateway.
   * Use when the object store should serve the file directly. Does not create a
   * grant (the store enforces the single-use expiry instead).
   */
  presignDirect(params: PresignParams): PresignResult {
    return presignS3Get(params);
  }
}

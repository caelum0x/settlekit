/**
 * @settlekit/file-delivery
 *
 * Secure digital download delivery: HMAC-signed download URLs, download grants
 * with usage limits and refund revocation, and AWS SigV4 presigning for
 * S3-compatible object storage.
 */

export {
  canonicalString,
  generateSignedDownloadUrl,
  signCanonical,
  verifySignedUrl,
  type GenerateSignedDownloadUrlInput,
  type VerifyResult,
} from "./signed-url.js";

export {
  consumeDownload,
  createDownloadGrant,
  isExhausted,
  revokeOnRefund,
  type CreateGrantInput,
  type DownloadGrant,
} from "./grants.js";

export {
  presignS3Get,
  type PresignResult,
  type PresignS3GetInput,
} from "./s3-presign.js";

export {
  InMemoryGrantStore,
  type GrantStore,
} from "./store.js";

export {
  FileDeliveryService,
  type FileDeliveryConfig,
  type IssueDownloadInput,
  type IssuedDownload,
  type PresignParams,
} from "./service.js";

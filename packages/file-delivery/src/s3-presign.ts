import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 query-string presigning for S3-compatible object
 * storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO, ...).
 *
 * This is a real, from-scratch implementation of the SigV4 presigning
 * algorithm using only node:crypto. It produces a presigned GET URL whose
 * signature an S3-compatible endpoint will accept, so it is fully verifiable
 * against a live bucket. It is also deterministic for fixed inputs (bucket,
 * key, credentials, region, expiry, and timestamp), which the tests assert.
 *
 * Reference: AWS "Signing AWS requests with Signature Version 4" — the
 * "query parameters" (presigned URL) variant.
 */

export interface PresignS3GetInput {
  bucket: string;
  /** Object key within the bucket (may contain "/"). Leading "/" is ignored. */
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Validity window in seconds (1..604800). */
  expiresIn: number;
  /**
   * Endpoint host. Defaults to AWS S3 virtual-hosted style:
   *   `<bucket>.s3.<region>.amazonaws.com`.
   * For R2 / MinIO pass the account/host explicitly, e.g.
   *   `<account>.r2.cloudflarestorage.com`.
   */
  endpoint?: string;
  /**
   * Whether to use path-style addressing (host/bucket/key) instead of
   * virtual-hosted style (bucket.host/key). Defaults to false (virtual-hosted).
   */
  forcePathStyle?: boolean;
  /** Use http instead of https (e.g. local MinIO). Defaults to https. */
  insecure?: boolean;
  /** STS session token, included as X-Amz-Security-Token when present. */
  sessionToken?: string;
  /** Override the signing time (defaults to now). */
  date?: Date;
}

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const MAX_EXPIRES = 604800; // 7 days

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 unreserved-only encoding used by SigV4. `encodeURIComponent`
 * leaves !*'() unescaped, so escape them; for object keys, "/" is preserved.
 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of Buffer.from(value, "utf8").toString("utf8")) {
    if (
      (ch >= "A" && ch <= "Z") ||
      (ch >= "a" && ch <= "z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "-" ||
      ch === "_" ||
      ch === "." ||
      ch === "~"
    ) {
      out += ch;
    } else if (ch === "/" && !encodeSlash) {
      out += "/";
    } else {
      const bytes = Buffer.from(ch, "utf8");
      for (const b of bytes) {
        out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

/** Format a Date as the AMZ basic timestamp: YYYYMMDDTHHMMSSZ. */
function amzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString(); // 2026-06-15T12:34:56.789Z
  const stamp = iso.slice(0, 19).replace(/[-:]/g, ""); // 20260615T123456
  return { amzDate: `${stamp}Z`, dateStamp: stamp.slice(0, 8) };
}

/** Derive the SigV4 signing key for the given date/region/service. */
function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface PresignResult {
  url: string;
  /** Hex signature (also embedded in the URL as X-Amz-Signature). */
  signature: string;
  /** Absolute expiry (unix seconds) implied by amzDate + expiresIn. */
  expiresAt: number;
}

/**
 * Produce a presigned S3 GET URL using AWS SigV4 (query-parameter variant).
 *
 * @throws RangeError on invalid expiry or missing required inputs.
 */
export function presignS3Get(input: PresignS3GetInput): PresignResult {
  const {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    expiresIn,
    forcePathStyle = false,
    insecure = false,
    sessionToken,
  } = input;

  if (!bucket) throw new RangeError("bucket is required");
  if (!input.key) throw new RangeError("key is required");
  if (!region) throw new RangeError("region is required");
  if (!accessKeyId) throw new RangeError("accessKeyId is required");
  if (!secretAccessKey) throw new RangeError("secretAccessKey is required");
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES) {
    throw new RangeError(`expiresIn must be an integer in [1, ${MAX_EXPIRES}]`);
  }

  const key = input.key.replace(/^\/+/, "");
  const date = input.date ?? new Date();
  const { amzDate: amzDateStr, dateStamp } = amzDate(date);

  const awsS3Host = region === "us-east-1" ? "s3.amazonaws.com" : `s3.${region}.amazonaws.com`;
  const defaultEndpoint = forcePathStyle
    ? awsS3Host
    : `${bucket}.${awsS3Host}`;
  const host = input.endpoint ?? defaultEndpoint;

  // Canonical URI: virtual-hosted style => /key, path style => /bucket/key.
  const canonicalUri = forcePathStyle
    ? `/${uriEncode(bucket, true)}/${uriEncode(key, false)}`
    : `/${uriEncode(key, false)}`;

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // SignedHeaders for presigned GET: only `host` is signed.
  const signedHeaders = "host";
  const canonicalHeaders = `host:${host}\n`;

  // Build the query parameters that participate in signing. They must be
  // sorted by key (and value) and URI-encoded per RFC 3986.
  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDateStr],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  if (sessionToken) {
    queryParams.push(["X-Amz-Security-Token", sessionToken]);
  }

  const canonicalQuery = queryParams
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDateStr,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, SERVICE);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const scheme = insecure ? "http" : "https";
  const url = `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;

  // Expiry derived from the signing timestamp.
  const signedAtSec = Math.floor(date.getTime() / 1000);

  return { url, signature, expiresAt: signedAtSec + expiresIn };
}

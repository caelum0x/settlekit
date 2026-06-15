import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secure signed download URLs.
 *
 * A signed URL embeds the file id, an absolute expiry, an opaque download token,
 * and an HMAC-SHA256 signature over a canonical string. The signature binds all
 * fields together so neither the file id, expiry, nor token can be tampered with
 * without invalidating the signature.
 *
 * Canonical string (newline-joined, fixed field order):
 *   fileId\nexp\ndl
 *
 * Query parameters on the produced URL:
 *   - fileId : the file asset id being granted
 *   - exp    : absolute unix expiry in seconds
 *   - dl     : opaque per-grant download token (ties a URL to a DownloadGrant)
 *   - sig    : base64url HMAC-SHA256 signature over the canonical string
 */

export interface GenerateSignedDownloadUrlInput {
  /** File asset id to grant access to. */
  fileId: string;
  /** Base URL of the delivery endpoint, e.g. "https://dl.settlekit.dev/download". */
  baseUrl: string;
  /** HMAC signing secret. Must be kept server-side. */
  secret: string;
  /** Validity window in seconds from `now`. Must be a positive integer. */
  expiresInSec: number;
  /** Maximum number of downloads this URL permits (recorded as `dl` token entropy). */
  maxDownloads: number;
  /** Opaque download token. If omitted, a deterministic token is derived. */
  downloadToken?: string;
  /** Override the current time (seconds since epoch). Defaults to Date.now(). */
  now?: number;
}

export interface VerifyResult {
  valid: boolean;
  fileId?: string;
  /** Absolute expiry (unix seconds) parsed from the URL, when present. */
  exp?: number;
  /** Opaque download token parsed from the URL, when present. */
  downloadToken?: string;
  /** Reason the URL failed verification, when invalid. */
  reason?:
    | "missing_params"
    | "bad_expiry"
    | "expired"
    | "signature_mismatch"
    | "malformed_url";
}

const FIELD_SEP = "\n";

function nowSeconds(override?: number): number {
  return typeof override === "number" ? Math.floor(override) : Math.floor(Date.now() / 1000);
}

/** Build the canonical string that the signature is computed over. */
export function canonicalString(fileId: string, exp: number, downloadToken: string): string {
  return [fileId, String(exp), downloadToken].join(FIELD_SEP);
}

/** Compute the base64url HMAC-SHA256 signature for the canonical string. */
export function signCanonical(canonical: string, secret: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
}

/**
 * Derive an opaque, unguessable download token when the caller does not supply
 * one. Each call mixes fresh random entropy so two grants issued for the same
 * file/expiry never collide, while the secret keeps the token unforgeable. The
 * token is bound into the signature by the caller, so its exact bytes do not
 * affect verification — only uniqueness matters.
 */
function deriveDownloadToken(
  fileId: string,
  exp: number,
  maxDownloads: number,
  secret: string,
): string {
  const nonce = randomBytes(16).toString("hex");
  return createHmac("sha256", secret)
    .update(
      `dl${FIELD_SEP}${fileId}${FIELD_SEP}${exp}${FIELD_SEP}${maxDownloads}${FIELD_SEP}${nonce}`,
      "utf8",
    )
    .digest("base64url")
    .slice(0, 22);
}

/**
 * Generate a signed download URL.
 *
 * @throws RangeError when `expiresInSec` is not a positive integer or
 *   `maxDownloads` is not a positive integer.
 */
export function generateSignedDownloadUrl(input: GenerateSignedDownloadUrlInput): string {
  const { fileId, baseUrl, secret, expiresInSec, maxDownloads } = input;

  if (!fileId) throw new RangeError("fileId is required");
  if (!secret) throw new RangeError("secret is required");
  if (!Number.isInteger(expiresInSec) || expiresInSec <= 0) {
    throw new RangeError("expiresInSec must be a positive integer");
  }
  if (!Number.isInteger(maxDownloads) || maxDownloads <= 0) {
    throw new RangeError("maxDownloads must be a positive integer");
  }

  const exp = nowSeconds(input.now) + expiresInSec;
  const downloadToken =
    input.downloadToken ?? deriveDownloadToken(fileId, exp, maxDownloads, secret);
  const sig = signCanonical(canonicalString(fileId, exp, downloadToken), secret);

  // URL constructor validates the base and safely encodes query params.
  const url = new URL(baseUrl);
  url.searchParams.set("fileId", fileId);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("dl", downloadToken);
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** Constant-time comparison of two base64url signatures. */
function signaturesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a signed download URL: checks the HMAC signature and the expiry.
 *
 * @param url     the full signed URL to verify.
 * @param secret  the HMAC signing secret used to generate it.
 * @param now     current time in unix seconds (defaults to Date.now()).
 */
export function verifySignedUrl(url: string, secret: string, now?: number): VerifyResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "malformed_url" };
  }

  const fileId = parsed.searchParams.get("fileId");
  const expRaw = parsed.searchParams.get("exp");
  const downloadToken = parsed.searchParams.get("dl");
  const sig = parsed.searchParams.get("sig");

  if (!fileId || !expRaw || !downloadToken || !sig) {
    return { valid: false, reason: "missing_params" };
  }

  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= 0) {
    return { valid: false, reason: "bad_expiry" };
  }

  const expected = signCanonical(canonicalString(fileId, exp, downloadToken), secret);
  if (!signaturesEqual(sig, expected)) {
    return { valid: false, fileId, exp, downloadToken, reason: "signature_mismatch" };
  }

  if (nowSeconds(now) >= exp) {
    return { valid: false, fileId, exp, downloadToken, reason: "expired" };
  }

  return { valid: true, fileId, exp, downloadToken };
}

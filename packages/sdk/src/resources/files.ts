/**
 * File delivery resource client. Maps to `/v1/files`.
 *
 * Issues HMAC-signed, usage-limited download URLs and redeems them.
 */
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link FilesResource.issueDownload}. */
export interface IssueDownloadInput {
  fileId: string;
  customerId: string;
  expiresInSec?: number;
  maxDownloads?: number;
}

/** Result of issuing a signed download (shape determined by the file service). */
export interface IssueDownloadResult {
  url: string;
  expiresAt?: string;
  [key: string]: unknown;
}

/** Result of redeeming a signed download URL. */
export interface RedeemDownloadResult {
  [key: string]: unknown;
}

/** Client for file delivery endpoints. */
export class FilesResource {
  constructor(private readonly http: HttpClient) {}

  /** Issue a signed, usage-limited download URL + grant. */
  issueDownload(input: IssueDownloadInput, options?: RequestOptions): Promise<IssueDownloadResult> {
    return this.http.post<IssueDownloadResult>("/v1/files/downloads", input, options);
  }

  /** Redeem a signed download URL (the full URL produced by `issueDownload`). */
  redeemDownload(url: string, options?: RequestOptions): Promise<RedeemDownloadResult> {
    return this.http.get<RedeemDownloadResult>("/v1/files/download", {
      ...options,
      query: { url },
    });
  }
}

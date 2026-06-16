/**
 * Organization settings resource client.
 *
 * Maps to `/v1/settings` — the merchant dashboard's editable config. Reading
 * returns defaults when unset; updating merges the provided keys over current.
 */
import type { HttpClient, RequestOptions } from "../http-client.js";

/** The payment rail used by default for new charges. */
export type PaymentRail = "arc" | "circle" | "x402";

/** Organization settings as returned by the API. */
export interface OrgSettings {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: PaymentRail;
}

/** A partial settings patch; only provided keys are updated. */
export interface UpdateSettingsInput {
  orgName?: string;
  supportEmail?: string;
  payoutCurrency?: string;
  webhookSecret?: string;
  defaultRail?: PaymentRail;
}

/** Client for organization-settings endpoints. */
export class SettingsResource {
  constructor(private readonly http: HttpClient) {}

  /** Read settings for an organization (defaults to the platform org). */
  retrieve(organizationId?: string, options?: RequestOptions): Promise<OrgSettings> {
    const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return this.http.get<OrgSettings>(`/v1/settings${qs}`, options);
  }

  /** Patch settings, merging `patch` over current values. */
  update(
    patch: UpdateSettingsInput,
    organizationId?: string,
    options?: RequestOptions,
  ): Promise<OrgSettings> {
    const body = organizationId ? { ...patch, organizationId } : patch;
    return this.http.post<OrgSettings>("/v1/settings", body, options);
  }
}

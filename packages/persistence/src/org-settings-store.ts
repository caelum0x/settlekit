/**
 * Org-settings persistence: the merchant dashboard's configurable settings
 * (org name, support email, payout currency, webhook secret, default rail).
 *
 * Stored under `organizations.metadata.settings` in Postgres, with an in-memory
 * implementation for the no-database path. Both satisfy {@link OrgSettingsStore}.
 */
import { eq, type Database, organizations } from "@settlekit/database";

/** Configurable per-organization dashboard settings. */
export interface OrgSettings {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: "arc" | "circle" | "x402";
}

/** Sensible defaults applied when an org has no settings yet. */
export function defaultOrgSettings(orgName = "SettleKit Merchant"): OrgSettings {
  return {
    orgName,
    supportEmail: "",
    payoutCurrency: "USDC",
    webhookSecret: "",
    defaultRail: "circle",
  };
}

/** Read/update an organization's dashboard settings. */
export interface OrgSettingsStore {
  get(organizationId: string): Promise<OrgSettings>;
  update(organizationId: string, patch: Partial<OrgSettings>): Promise<OrgSettings>;
}

/** Coerce an unknown jsonb value into a partial settings object. */
function asPartial(value: unknown): Partial<OrgSettings> {
  return value && typeof value === "object" ? (value as Partial<OrgSettings>) : {};
}

/** Postgres-backed store over `organizations.metadata.settings`. */
export class PgOrgSettingsStore implements OrgSettingsStore {
  constructor(private readonly db: Database) {}

  async get(organizationId: string): Promise<OrgSettings> {
    const rows = await this.db
      .select({ name: organizations.name, metadata: organizations.metadata })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const row = rows[0];
    const base = defaultOrgSettings(row?.name ?? undefined);
    return { ...base, ...asPartial(row?.metadata?.settings) };
  }

  async update(organizationId: string, patch: Partial<OrgSettings>): Promise<OrgSettings> {
    const rows = await this.db
      .select({ name: organizations.name, metadata: organizations.metadata })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const row = rows[0];
    const current = { ...defaultOrgSettings(row?.name ?? undefined), ...asPartial(row?.metadata?.settings) };
    const next = { ...current, ...patch };
    const metadata = { ...(row?.metadata ?? {}), settings: next };
    await this.db.update(organizations).set({ metadata }).where(eq(organizations.id, organizationId));
    return next;
  }
}

/** In-memory store for the no-database path. */
export class InMemoryOrgSettingsStore implements OrgSettingsStore {
  private readonly byOrg = new Map<string, OrgSettings>();

  async get(organizationId: string): Promise<OrgSettings> {
    return this.byOrg.get(organizationId) ?? defaultOrgSettings();
  }

  async update(organizationId: string, patch: Partial<OrgSettings>): Promise<OrgSettings> {
    const next = { ...(this.byOrg.get(organizationId) ?? defaultOrgSettings()), ...patch };
    this.byOrg.set(organizationId, next);
    return next;
  }
}

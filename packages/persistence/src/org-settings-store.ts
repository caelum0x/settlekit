/**
 * Org-settings persistence: the merchant dashboard's configurable settings
 * (org name, support email, payout currency, webhook secret, default rail).
 *
 * Stored under `organizations.metadata.settings` in Postgres, with an in-memory
 * implementation for the no-database path. Both satisfy {@link OrgSettingsStore}.
 */
import type { TaxSettings } from "@settlekit/tax";
import { eq, type Database, organizations } from "@settlekit/database";

/** Configurable per-organization dashboard settings. */
export interface OrgSettings {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: "arc" | "circle" | "x402";
  /** Networks the merchant accepts payments on (onboarding). */
  acceptedNetworks?: string[];
  /** Receiving address per accepted network (onboarding). */
  payToByNetwork?: Record<string, string>;
  /** ISO time the merchant finished onboarding. */
  onboardedAt?: string;
  /** Demo / test account: never shown on the public proof page. */
  testAccount?: boolean;
  /** Checkout tax + seller tax identity on receipts. Off when absent. */
  tax?: TaxSettings;
  /**
   * Sites allowed to embed the checkout and receive its success message
   * (exact origins, e.g. "https://shop.example.com").
   */
  embedOrigins?: string[];
  /** Team members and pending invitations (dashboard roles). */
  team?: TeamSettings;
  /** Hosted storefront (/store/<slug> on the checkout). */
  store?: StoreSettings;
}

/** A merchant's hosted storefront. */
export interface StoreSettings {
  enabled: boolean;
  /** URL slug, unique across merchants. */
  slug: string;
  title?: string;
  tagline?: string;
  /** https logo image. */
  logoUrl?: string;
  /** #rrggbb accent colour. */
  accentColor?: string;
  /** Search / social description. */
  seoDescription?: string;
  /** Custom domain the merchant points at the checkout (routed by the host). */
  customDomain?: string;
}

/** An account that belongs to the organization with a role. */
export interface TeamMember {
  accountId: string;
  email: string;
  role: string;
  joinedAt: string;
}

/** A pending (or closed) invitation; only the token hash is stored. */
export interface TeamInvitation {
  id: string;
  email: string;
  role: string;
  tokenHash: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
}

export interface TeamSettings {
  members: TeamMember[];
  invitations: TeamInvitation[];
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
  /** The organization whose storefront uses `slug` (or custom domain), if any. */
  findByStore?(match: { slug?: string; domain?: string }): Promise<{ organizationId: string; settings: OrgSettings } | null>;
}

function storeMatches(settings: Partial<OrgSettings>, match: { slug?: string; domain?: string }): boolean {
  const store = settings.store;
  if (!store) return false;
  if (match.slug !== undefined) return store.slug === match.slug;
  if (match.domain !== undefined) return store.customDomain?.toLowerCase() === match.domain.toLowerCase();
  return false;
}

/** Coerce an unknown jsonb value into a partial settings object. */
function asPartial(value: unknown): Partial<OrgSettings> {
  return value && typeof value === "object" ? (value as Partial<OrgSettings>) : {};
}

/** Postgres-backed store over `organizations.metadata.settings`. */
export class PgOrgSettingsStore implements OrgSettingsStore {
  constructor(private readonly db: Database) {}

  async findByStore(match: { slug?: string; domain?: string }): Promise<{ organizationId: string; settings: OrgSettings } | null> {
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name, metadata: organizations.metadata })
      .from(organizations);
    for (const row of rows) {
      const partial = asPartial(row.metadata?.settings);
      if (storeMatches(partial, match)) {
        return { organizationId: row.id, settings: { ...defaultOrgSettings(row.name ?? undefined), ...partial } };
      }
    }
    return null;
  }

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
    if (row === undefined) {
      // Self-serve merchants get their organization row on first save;
      // an UPDATE alone would silently drop their settings.
      await this.db
        .insert(organizations)
        .values({ id: organizationId, name: next.orgName, slug: organizationId, status: "active", metadata })
        .onConflictDoUpdate({ target: organizations.id, set: { metadata } });
      return next;
    }
    await this.db.update(organizations).set({ metadata }).where(eq(organizations.id, organizationId));
    return next;
  }
}

/** In-memory store for the no-database path. */
export class InMemoryOrgSettingsStore implements OrgSettingsStore {
  private readonly byOrg = new Map<string, OrgSettings>();

  async findByStore(match: { slug?: string; domain?: string }): Promise<{ organizationId: string; settings: OrgSettings } | null> {
    for (const [organizationId, settings] of this.byOrg) {
      if (storeMatches(settings, match)) return { organizationId, settings };
    }
    return null;
  }

  async get(organizationId: string): Promise<OrgSettings> {
    return this.byOrg.get(organizationId) ?? defaultOrgSettings();
  }

  async update(organizationId: string, patch: Partial<OrgSettings>): Promise<OrgSettings> {
    const next = { ...(this.byOrg.get(organizationId) ?? defaultOrgSettings()), ...patch };
    this.byOrg.set(organizationId, next);
    return next;
  }
}

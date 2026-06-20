import { describe, it, expect } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import {
  schema,
  organizations,
  users,
  merchants,
  customers,
  payoutWallets,
  products,
  prices,
  bundles,
  bundleItems,
  fileAssets,
  checkoutSessions,
  payments,
  subscriptions,
  usageMeters,
  creditBalances,
  entitlements,
  licenseKeys,
  apiKeys,
  deliveryPlans,
  deliveryActions,
  deliveryRuns,
  deliveryLogs,
  webhookEndpoints,
  webhookEvents,
  githubInstallations,
  githubRepositories,
  githubTeams,
  githubRepoAccessGrants,
  githubAccessSyncRuns,
  discordConnections,
  discordGuilds,
  discordRoles,
  discordRoleGrants,
  saasPlans,
  saasFeatures,
  saasSeats,
  saasEntitlementRules,
  agentServices,
  agentServiceMetadata,
  agentBuyers,
  agentUsageEvents,
  escrowTasks,
  escrowFundings,
  escrowSubmissions,
  escrowReleases,
  escrowRefunds,
  escrowReviews,
  escrowDisputes,
  marketplaceListings,
  riskProfiles,
  agentReputations,
  downloadGrants,
  DATABASE_TABLES,
  isSchemaTable,
} from "../src/index.js";

/**
 * Every physical table name required by plan §15 + §25. The schema must map
 * each of these one-to-one (no missing, no extra).
 */
const EXPECTED_TABLE_NAMES = [
  "organizations",
  "users",
  "merchants",
  "customers",
  "payout_wallets",
  "products",
  "prices",
  "bundles",
  "bundle_items",
  "checkout_sessions",
  "payments",
  "subscriptions",
  "usage_meters",
  "credit_balances",
  "entitlements",
  "license_keys",
  "api_keys",
  "delivery_plans",
  "delivery_runs",
  "delivery_actions",
  "delivery_logs",
  "file_assets",
  "webhook_endpoints",
  "webhook_events",
  "github_installations",
  "github_repositories",
  "github_teams",
  "github_repo_access_grants",
  "github_access_sync_runs",
  "discord_connections",
  "discord_guilds",
  "discord_roles",
  "discord_role_grants",
  "saas_plans",
  "saas_features",
  "saas_seats",
  "saas_entitlement_rules",
  "agent_services",
  "agent_service_metadata",
  "agent_buyers",
  "agent_usage_events",
  "escrow_tasks",
  "escrow_fundings",
  "escrow_submissions",
  "escrow_releases",
  "escrow_refunds",
  "escrow_reviews",
  "escrow_disputes",
  "marketplace_listings",
  "risk_profiles",
  "agent_reputations",
  "download_grants",
  "coupons",
  "coupon_redemptions",
  "invoices",
  "refunds",
  "dunning_states",
  "disputes",
  "payouts",
  "auth_accounts",
  "auth_sessions",
  "auth_magic_links",
  "auth_password_credentials",
  "auth_wallet_nonces",
  "worker_delivery_queue",
  "worker_webhook_jobs",
  "worker_email_ledger",
  "worker_dunning_attempts",
  "lepton_sources",
  "lepton_citations",
  "lepton_royalty_legs",
  "lepton_streams",
  "lepton_stream_settlements",
  "lepton_agent_runs",
  "lepton_agent_purchases",
  "lepton_wallets",
  "lepton_payees",
  "lepton_payee_splits",
  "lepton_settlements",
  "lepton_nonces",
  "lepton_lineage_edges",
  "lepton_citation_proofs",
] as const;

describe("schema table coverage", () => {
  it("exposes every entity from the plan with no gaps or extras", () => {
    const actual = new Set(DATABASE_TABLES);
    for (const name of EXPECTED_TABLE_NAMES) {
      expect(actual.has(name), `missing table ${name}`).toBe(true);
    }
    expect(DATABASE_TABLES).toHaveLength(EXPECTED_TABLE_NAMES.length);
    expect(Object.keys(schema)).toHaveLength(EXPECTED_TABLE_NAMES.length);
  });

  it("maps each schema key to a real pgTable with a matching name", () => {
    expect(getTableName(organizations)).toBe("organizations");
    expect(getTableName(payoutWallets)).toBe("payout_wallets");
    expect(getTableName(checkoutSessions)).toBe("checkout_sessions");
    expect(getTableName(githubRepoAccessGrants)).toBe(
      "github_repo_access_grants",
    );
    expect(getTableName(agentServiceMetadata)).toBe("agent_service_metadata");
    expect(getTableName(escrowDisputes)).toBe("escrow_disputes");
    expect(getTableName(riskProfiles)).toBe("risk_profiles");
  });

  it("recognises known table variable names via isSchemaTable", () => {
    expect(isSchemaTable("organizations")).toBe(true);
    expect(isSchemaTable("payments")).toBe(true);
    expect(isSchemaTable("not_a_table")).toBe(false);
  });
});

describe("column presence", () => {
  it("gives every table an id primary key and timestamps", () => {
    for (const table of Object.values(schema)) {
      const columns = getTableColumns(table);
      expect(columns.id, `${getTableName(table)} missing id`).toBeDefined();
      expect(columns.id.primary).toBe(true);
      expect(
        columns.createdAt,
        `${getTableName(table)} missing createdAt`,
      ).toBeDefined();
    }
  });

  it("models accounts columns and foreign keys", () => {
    const userCols = getTableColumns(users);
    expect(userCols.email).toBeDefined();
    expect(userCols.organizationId).toBeDefined();
    expect(userCols.role).toBeDefined();

    const customerCols = getTableColumns(customers);
    expect(customerCols.merchantId).toBeDefined();
    expect(customerCols.walletAddress).toBeDefined();

    const walletCols = getTableColumns(payoutWallets);
    expect(walletCols.address).toBeDefined();
    expect(walletCols.isDefault).toBeDefined();

    expect(getTableColumns(merchants).defaultCurrency).toBeDefined();
    expect(getTableColumns(organizations).slug).toBeDefined();
  });

  it("models catalog amount and relation columns", () => {
    expect(getTableColumns(prices).unitAmount).toBeDefined();
    expect(getTableColumns(prices).productId).toBeDefined();
    expect(getTableColumns(products).type).toBeDefined();
    expect(getTableColumns(bundleItems).bundleId).toBeDefined();
    expect(getTableColumns(bundleItems).quantity).toBeDefined();
    expect(getTableColumns(fileAssets).storageKey).toBeDefined();
  });

  it("models payments, subscriptions and balances", () => {
    expect(getTableColumns(payments).txHash).toBeDefined();
    expect(getTableColumns(payments).amount).toBeDefined();
    expect(getTableColumns(checkoutSessions).lineItems).toBeDefined();
    expect(getTableColumns(subscriptions).currentPeriodEnd).toBeDefined();
    expect(getTableColumns(usageMeters).eventName).toBeDefined();
    expect(getTableColumns(creditBalances).balance).toBeDefined();
  });

  it("models entitlements, license keys and api keys", () => {
    expect(getTableColumns(entitlements).type).toBeDefined();
    expect(getTableColumns(licenseKeys).key).toBeDefined();
    expect(getTableColumns(licenseKeys).maxActivations).toBeDefined();
    expect(getTableColumns(apiKeys).hashedKey).toBeDefined();
    expect(getTableColumns(apiKeys).scopes).toBeDefined();
  });

  it("models delivery pipeline", () => {
    expect(getTableColumns(deliveryPlans).status).toBeDefined();
    expect(getTableColumns(deliveryActions).config).toBeDefined();
    expect(getTableColumns(deliveryRuns).actionRuns).toBeDefined();
    expect(getTableColumns(deliveryLogs).message).toBeDefined();
  });

  it("models webhooks", () => {
    expect(getTableColumns(webhookEndpoints).secret).toBeDefined();
    expect(getTableColumns(webhookEndpoints).enabledEvents).toBeDefined();
    expect(getTableColumns(webhookEvents).payload).toBeDefined();
    expect(getTableColumns(webhookEvents).attempts).toBeDefined();
  });

  it("models github integration", () => {
    expect(getTableColumns(githubInstallations).installationId).toBeDefined();
    expect(getTableColumns(githubRepositories).fullName).toBeDefined();
    expect(getTableColumns(githubTeams).slug).toBeDefined();
    expect(getTableColumns(githubRepoAccessGrants).permission).toBeDefined();
    expect(getTableColumns(githubAccessSyncRuns).result).toBeDefined();
  });

  it("models discord integration", () => {
    expect(getTableColumns(discordConnections).botToken).toBeDefined();
    expect(getTableColumns(discordGuilds).guildId).toBeDefined();
    expect(getTableColumns(discordRoles).roleId).toBeDefined();
    expect(getTableColumns(discordRoleGrants).status).toBeDefined();
  });

  it("models saas packaging", () => {
    expect(getTableColumns(saasPlans).code).toBeDefined();
    expect(getTableColumns(saasFeatures).key).toBeDefined();
    expect(getTableColumns(saasSeats).subscriptionId).toBeDefined();
    expect(getTableColumns(saasEntitlementRules).entitlementType).toBeDefined();
  });

  it("models agent services", () => {
    expect(getTableColumns(agentServices).pricePerCall).toBeDefined();
    expect(getTableColumns(agentServiceMetadata).capabilities).toBeDefined();
    expect(getTableColumns(agentBuyers).walletAddress).toBeDefined();
    expect(getTableColumns(agentUsageEvents).occurredAt).toBeDefined();
  });

  it("models escrow lifecycle", () => {
    expect(getTableColumns(escrowTasks).acceptanceCriteria).toBeDefined();
    expect(getTableColumns(escrowFundings).fundedAt).toBeDefined();
    expect(getTableColumns(escrowSubmissions).artifacts).toBeDefined();
    expect(getTableColumns(escrowReleases).amount).toBeDefined();
    expect(getTableColumns(escrowDisputes).reason).toBeDefined();
  });

  it("models marketplace and risk", () => {
    expect(getTableColumns(marketplaceListings).slug).toBeDefined();
    expect(getTableColumns(marketplaceListings).tags).toBeDefined();
    expect(getTableColumns(riskProfiles).score).toBeDefined();
    expect(getTableColumns(riskProfiles).level).toBeDefined();
  });

  it("models agent reputations and download grants", () => {
    expect(getTableColumns(agentReputations).serviceId).toBeDefined();
    expect(getTableColumns(agentReputations).ratingCount).toBeDefined();
    expect(getTableColumns(agentReputations).ratingSum).toBeDefined();
    expect(getTableColumns(downloadGrants).fileId).toBeDefined();
    expect(getTableColumns(downloadGrants).downloadToken).toBeDefined();
    expect(getTableColumns(downloadGrants).status).toBeDefined();
  });
});

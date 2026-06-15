/**
 * The full SettleKit persistence schema. Every table is re-exported here and
 * collected into the {@link schema} object passed to drizzle so that the query
 * builder is fully typed and relational helpers can resolve table references.
 */
export * from "./accounts.js";
export * from "./catalog.js";
export * from "./payments.js";
export * from "./entitlements.js";
export * from "./delivery.js";
export * from "./webhooks.js";
export * from "./github.js";
export * from "./discord.js";
export * from "./saas.js";
export * from "./agents.js";
export * from "./escrow.js";
export * from "./marketplace.js";
export * from "./file_delivery.js";

import {
  organizations,
  users,
  merchants,
  customers,
  payoutWallets,
} from "./accounts.js";
import {
  products,
  prices,
  bundles,
  bundleItems,
  fileAssets,
} from "./catalog.js";
import {
  checkoutSessions,
  payments,
  subscriptions,
  usageMeters,
  creditBalances,
} from "./payments.js";
import { entitlements, licenseKeys, apiKeys } from "./entitlements.js";
import {
  deliveryPlans,
  deliveryActions,
  deliveryRuns,
  deliveryLogs,
} from "./delivery.js";
import { webhookEndpoints, webhookEvents } from "./webhooks.js";
import {
  githubInstallations,
  githubRepositories,
  githubTeams,
  githubRepoAccessGrants,
  githubAccessSyncRuns,
} from "./github.js";
import {
  discordConnections,
  discordGuilds,
  discordRoles,
  discordRoleGrants,
} from "./discord.js";
import {
  saasPlans,
  saasFeatures,
  saasSeats,
  saasEntitlementRules,
} from "./saas.js";
import {
  agentServices,
  agentServiceMetadata,
  agentBuyers,
  agentUsageEvents,
} from "./agents.js";
import {
  escrowTasks,
  escrowFundings,
  escrowSubmissions,
  escrowReleases,
  escrowRefunds,
  escrowReviews,
  escrowDisputes,
} from "./escrow.js";
import { marketplaceListings, riskProfiles, agentReputations } from "./marketplace.js";
import { downloadGrants } from "./file_delivery.js";

/**
 * The schema object handed to `drizzle(client, { schema })`. Keys are the
 * exported table variable names; values are the {@link pgTable} definitions.
 */
export const schema = {
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
} as const;

/** The static type of the SettleKit schema object. */
export type Schema = typeof schema;

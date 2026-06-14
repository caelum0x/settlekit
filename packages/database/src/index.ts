export const DATABASE_TABLES = [
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
  "bundles",
  "bundle_items",
  "delivery_plans",
  "delivery_actions",
  "delivery_runs",
  "delivery_logs",
  "agent_services",
  "agent_service_metadata",
  "agent_buyers",
  "agent_usage_events",
  "escrow_tasks",
  "escrow_fundings",
  "escrow_submissions",
  "escrow_releases",
  "escrow_disputes",
] as const;

export type DatabaseTable = (typeof DATABASE_TABLES)[number];

export function isSettleKitTable(value: string): value is DatabaseTable {
  return (DATABASE_TABLES as readonly string[]).includes(value);
}

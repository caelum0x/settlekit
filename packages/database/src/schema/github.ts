import {
  pgTable,
  text,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants, customers } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A GitHub App installation owned by a merchant. */
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull().default("Organization"),
    status: text("status").notNull().default("active"),
    suspendedAt: nullableTimestamp("suspended_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("github_installations_merchant_id_idx").on(
      table.merchantId,
    ),
    installationIdx: index("github_installations_installation_id_idx").on(
      table.installationId,
    ),
  }),
);

/** A repository visible to an installation that can be sold access to. */
export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: idColumn(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id),
    repoId: integer("repo_id").notNull(),
    fullName: text("full_name").notNull(),
    private: text("private").notNull().default("true"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    installationIdx: index("github_repositories_installation_id_idx").on(
      table.installationId,
    ),
  }),
);

/** A GitHub team that grants can target. */
export const githubTeams = pgTable(
  "github_teams",
  {
    id: idColumn(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id),
    teamId: integer("team_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    installationIdx: index("github_teams_installation_id_idx").on(
      table.installationId,
    ),
  }),
);

/** A grant of repository / team access tied to an entitlement. */
export const githubRepoAccessGrants = pgTable(
  "github_repo_access_grants",
  {
    id: idColumn(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    entitlementId: text("entitlement_id"),
    repositoryId: text("repository_id").references(() => githubRepositories.id),
    teamId: text("team_id").references(() => githubTeams.id),
    githubUsername: text("github_username"),
    permission: text("permission").notNull().default("pull"),
    status: text("status").notNull().default("pending"),
    grantedAt: nullableTimestamp("granted_at"),
    revokedAt: nullableTimestamp("revoked_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    installationIdx: index(
      "github_repo_access_grants_installation_id_idx",
    ).on(table.installationId),
    customerIdx: index("github_repo_access_grants_customer_id_idx").on(
      table.customerId,
    ),
  }),
);

/** An audit record of a reconciliation run between SettleKit and GitHub. */
export const githubAccessSyncRuns = pgTable(
  "github_access_sync_runs",
  {
    id: idColumn(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id),
    status: text("status").notNull().default("pending"),
    granted: integer("granted").notNull().default(0),
    revoked: integer("revoked").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    result: jsonb("result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: nullableTimestamp("started_at"),
    completedAt: nullableTimestamp("completed_at"),
    ...timestamps,
  },
  (table) => ({
    installationIdx: index(
      "github_access_sync_runs_installation_id_idx",
    ).on(table.installationId),
  }),
);

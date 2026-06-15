/**
 * Narrow client interfaces for every external integration the delivery action
 * engine talks to. The app wires concrete implementations (real GitHub /
 * Discord SDK calls, real license/api-key issuance backed by the database,
 * real HTTP webhook senders, real transactional email providers). Handlers in
 * this package depend ONLY on these interfaces so the domain logic is testable
 * with in-memory doubles and free of provider lock-in.
 *
 * NONE of the concrete clients are imported here — they are injected via
 * {@link DeliveryClients} on the run context.
 */

import type {
  ApiKey,
  DiscordRoleGrant,
  GitHubRepoAccessGrant,
  LicenseKey,
  WebhookEventType,
} from "@settlekit/common";

/**
 * Grants a customer access to a private GitHub repository (the
 * `github_invite` action). Backed by the GitHub REST API
 * `PUT /repos/{owner}/{repo}/collaborators/{username}`.
 */
export interface GithubAccessClient {
  /**
   * Invite `githubUsername` to `repoOwner/repoName` with the given permission.
   * Returns the created invitation id (GitHub's `invitation.id`) plus the
   * persisted grant record.
   */
  inviteCollaborator(input: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    installationId: number;
    repoOwner: string;
    repoName: string;
    githubUsername: string;
    permission: "pull" | "push" | "maintain";
  }): Promise<GitHubRepoAccessGrant>;

  /** Revoke a previously created repo invitation / collaborator access. */
  removeCollaborator(input: {
    installationId: number;
    repoOwner: string;
    repoName: string;
    githubUsername: string;
    invitationId?: number;
  }): Promise<void>;

  /**
   * Add `githubUsername` to an organization team (the `github_team_add`
   * action). Backed by `PUT /orgs/{org}/teams/{team_slug}/memberships/{username}`.
   */
  addTeamMembership(input: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    installationId: number;
    orgLogin: string;
    teamSlug: string;
    githubUsername: string;
  }): Promise<GitHubRepoAccessGrant>;

  /** Remove a team membership previously granted. */
  removeTeamMembership(input: {
    installationId: number;
    orgLogin: string;
    teamSlug: string;
    githubUsername: string;
  }): Promise<void>;
}

/**
 * Assigns / removes Discord roles (the `discord_role_add` action). Backed by
 * `PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}`.
 */
export interface DiscordRoleClient {
  addRole(input: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    guildId: string;
    roleId: string;
    discordUserId: string;
  }): Promise<DiscordRoleGrant>;

  removeRole(input: {
    guildId: string;
    roleId: string;
    discordUserId: string;
  }): Promise<void>;
}

/** Issues license keys (the `license_key_create` action). */
export interface LicenseIssuer {
  issue(input: {
    organizationId: string;
    customerId: string;
    productId: string;
    entitlementId: string;
    policyId: string;
  }): Promise<LicenseKey>;

  revoke(licenseKeyId: string): Promise<void>;
}

/** Result of issuing an API key — the plaintext is returned exactly once. */
export interface IssuedApiKey {
  apiKey: ApiKey;
  /** Shown to the buyer once; never persisted in plaintext. */
  plaintext: string;
}

/** Issues API keys (the `api_key_create` action). */
export interface ApiKeyIssuer {
  issue(input: {
    organizationId: string;
    customerId: string;
    productId: string;
    entitlementId: string;
    scopes: string[];
  }): Promise<IssuedApiKey>;

  revoke(apiKeyId: string): Promise<void>;
}

/** A short-lived, signed URL granting download access to a file asset. */
export interface FileAccessGrant {
  fileId: string;
  url: string;
  expiresAt: string;
}

/** Grants access to a downloadable file asset (the `file_access_grant` action). */
export interface FileGrantor {
  grant(input: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    fileId: string;
  }): Promise<FileAccessGrant>;

  revoke(input: { fileId: string; customerId: string }): Promise<void>;
}

/** A SaaS feature entitlement created for a customer. */
export interface SaasEntitlementGrant {
  entitlementId: string;
  features: Record<string, boolean | number | string>;
}

/** Provisions SaaS feature flags / limits (the `saas_entitlement_create` action). */
export interface SaasEntitler {
  entitle(input: {
    organizationId: string;
    customerId: string;
    productId: string;
    entitlementId: string;
    features: Record<string, boolean | number | string>;
  }): Promise<SaasEntitlementGrant>;

  revoke(input: { entitlementId: string }): Promise<void>;
}

/** Delivery result of a single signed webhook POST. */
export interface WebhookDelivery {
  url: string;
  status: number;
  eventId: string;
}

/** Sends signed outbound webhooks (the `webhook_send` action). */
export interface WebhookSender {
  send(input: {
    organizationId: string;
    url: string;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  }): Promise<WebhookDelivery>;
}

/** Result of dispatching a transactional email. */
export interface EmailDelivery {
  messageId: string;
  to: string;
  template: string;
}

/** Sends transactional email (the `email_send` action). */
export interface EmailSender {
  send(input: {
    organizationId: string;
    to: string;
    template: string;
    variables: Record<string, unknown>;
  }): Promise<EmailDelivery>;
}

/**
 * The full set of injected clients. The app constructs this once and threads it
 * through every {@link DeliveryRunner} call via the run context.
 */
export interface DeliveryClients {
  github: GithubAccessClient;
  discord: DiscordRoleClient;
  license: LicenseIssuer;
  apiKey: ApiKeyIssuer;
  file: FileGrantor;
  saas: SaasEntitler;
  webhook: WebhookSender;
  email: EmailSender;
}

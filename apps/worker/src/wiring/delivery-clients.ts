/**
 * Concrete delivery clients — the bridge between the pure
 * {@link DeliveryClients} interfaces in `@settlekit/delivery` and the REAL
 * package implementations (`@settlekit/github`, `@settlekit/discord`,
 * `@settlekit/license-keys`, `@settlekit/api-keys`, `@settlekit/file-delivery`,
 * `@settlekit/saas`, `@settlekit/webhooks`, `@settlekit/notifications`).
 *
 * Each adapter performs the real domain call and persists the resulting grant
 * into the {@link WorkerStore} so later jobs (access sync, revocation) can reconcile
 * it. The GitHub/Discord low-level transports are injectable so the wiring test
 * can drive them with in-memory doubles, while production injects the real
 * Octokit / fetch-backed clients.
 */

import {
  generateId,
  toIso,
  type GitHubRepoAccessGrant,
} from "@settlekit/common";
import type {
  ApiKeyIssuer,
  DiscordRoleClient,
  EmailSender,
  FileGrantor,
  GithubAccessClient,
  IssuedApiKey,
  LicenseIssuer,
  SaasEntitler,
  WebhookSender,
  DeliveryClients,
} from "@settlekit/delivery";
import {
  createGitHubAccessClient,
  grantGitHubRepoAccess,
  revokeGitHubRepoAccess,
  markGitHubGrantRevoked,
  addToTeam,
  removeFromTeam,
  type GitHubApi,
} from "@settlekit/github";
import {
  grantDiscordRole,
  revokeDiscordRole,
  type DiscordApi,
} from "@settlekit/discord";
import {
  LicenseService,
  InMemoryLicenseStore,
  type LicenseStore,
} from "@settlekit/license-keys";
import {
  InMemoryApiKeyStore,
  issueApiKey,
  revoke as revokeApiKeyRecord,
  type ApiKeyEnv,
  type ApiKeyStore,
} from "@settlekit/api-keys";
import {
  FileDeliveryService,
  InMemoryGrantStore,
  type GrantStore,
} from "@settlekit/file-delivery";
import { buildWebhookEvent, deliverWithRetry, type HttpSender } from "@settlekit/webhooks";
import { createEmailClient } from "@settlekit/notifications";
import type { WorkerStore } from "../stores.js";
import type { WorkerConfig } from "../config.js";

/** Everything the wiring needs that is not in {@link WorkerConfig}. */
export interface DeliveryWiringDeps {
  config: WorkerConfig;
  stores: WorkerStore;
  /** Real `GitHubApi` (Octokit-backed in prod; in-memory in tests). */
  githubApi: GitHubApi;
  /** Real `DiscordApi` (fetch-backed in prod; in-memory in tests). */
  discordApi: DiscordApi;
  /** Webhook signing secret for outbound `webhook_send` actions. */
  webhookSigningSecret: string;
  /**
   * Shared persistence for issued access artifacts. In Postgres mode the runtime
   * passes the worker's Pg-backed stores so license keys / API keys / file grants
   * issued by delivery land in the SAME tables the API's verify/download routes
   * read. Omitted -> fresh in-memory stores.
   */
  licenseStore?: LicenseStore;
  apiKeyStore?: ApiKeyStore;
  fileGrantStore?: GrantStore;
  /** Optional injected email transport (tests supply an in-memory transport). */
  emailTransport?: Parameters<typeof createEmailClient>[0]["transport"];
  /**
   * Optional injected HTTP sender for outbound webhooks. Production omits it so
   * the real fetch-backed sender is used; tests supply an in-memory sender to
   * exercise the real `deliverWithRetry` path without live network I/O.
   */
  webhookSender?: HttpSender;
}

/** A GitHub repo-access adapter backed by the real granter/revoker functions. */
function buildGithubClient(deps: DeliveryWiringDeps): GithubAccessClient {
  const access = createGitHubAccessClient(deps.githubApi);
  return {
    async inviteCollaborator(input) {
      const grant = await grantGitHubRepoAccess(access, {
        organizationId: input.organizationId,
        installationId: input.installationId,
        customerId: input.customerId,
        entitlementId: input.entitlementId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        githubUsername: input.githubUsername,
        permission: input.permission,
      });
      await deps.stores.upsertGithubGrant(grant);
      return grant;
    },
    async removeCollaborator(input) {
      await revokeGitHubRepoAccess(access, {
        installationId: input.installationId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        githubUsername: input.githubUsername,
      });
    },
    async addTeamMembership(input) {
      await addToTeam(deps.githubApi, {
        org: input.orgLogin,
        teamSlug: input.teamSlug,
        username: input.githubUsername,
      });
      const grant: GitHubRepoAccessGrant = {
        id: generateId("githubRepoAccess"),
        organizationId: input.organizationId,
        installationId: input.installationId,
        customerId: input.customerId,
        entitlementId: input.entitlementId,
        repoOwner: input.orgLogin,
        repoName: `team:${input.teamSlug}`,
        githubUsername: input.githubUsername,
        status: "active",
        createdAt: toIso(new Date()),
      };
      await deps.stores.upsertGithubGrant(grant);
      return grant;
    },
    async removeTeamMembership(input) {
      await removeFromTeam(deps.githubApi, {
        org: input.orgLogin,
        teamSlug: input.teamSlug,
        username: input.githubUsername,
      });
    },
  };
}

/** A Discord role adapter backed by the real granter/revoker functions. */
function buildDiscordClient(deps: DeliveryWiringDeps): DiscordRoleClient {
  return {
    async addRole(input) {
      const grant = await grantDiscordRole(deps.discordApi, {
        organizationId: input.organizationId,
        guildId: input.guildId,
        roleId: input.roleId,
        customerId: input.customerId,
        entitlementId: input.entitlementId,
        discordUserId: input.discordUserId,
      });
      await deps.stores.upsertDiscordGrant(grant);
      if (grant.status === "failed") {
        throw new Error(`Discord role grant failed for user ${input.discordUserId} in guild ${input.guildId}`);
      }
      return grant;
    },
    async removeRole(input) {
      const existing = await deps.stores.findDiscordGrant({
        guildId: input.guildId,
        roleId: input.roleId,
        discordUserId: input.discordUserId,
      });
      const grant = existing ?? {
        id: generateId("discordRoleAccess"),
        organizationId: "",
        guildId: input.guildId,
        roleId: input.roleId,
        customerId: "",
        entitlementId: "",
        discordUserId: input.discordUserId,
        status: "active" as const,
        createdAt: toIso(new Date()),
      };
      const revoked = await revokeDiscordRole(deps.discordApi, grant);
      await deps.stores.upsertDiscordGrant(revoked);
    },
  };
}

/** License adapter backed by the real {@link LicenseService}. */
function buildLicenseClient(deps: DeliveryWiringDeps): LicenseIssuer {
  const service = new LicenseService(deps.licenseStore ?? new InMemoryLicenseStore(), {
    tokenSecret: deps.config.license.tokenSecret,
  });
  return {
    async issue(input) {
      return service.issue({
        organizationId: input.organizationId,
        customerId: input.customerId,
        productId: input.productId,
        entitlementId: input.entitlementId,
        machineLimit: 1,
      });
    },
    async revoke(licenseKeyId) {
      await service.revoke(licenseKeyId);
    },
  };
}

/** API-key adapter backed by the real `issueApiKey` + the shared store. */
function buildApiKeyClient(deps: DeliveryWiringDeps): ApiKeyIssuer {
  const store = deps.apiKeyStore ?? new InMemoryApiKeyStore();
  // Map issued key ids to their hash so revoke-by-id can locate the record.
  const idToHash = new Map<string, string>();
  return {
    async issue(input): Promise<IssuedApiKey> {
      const env: ApiKeyEnv = "live";
      const result = issueApiKey({
        organizationId: input.organizationId,
        customerId: input.customerId,
        productId: input.productId,
        entitlementId: input.entitlementId,
        scopes: input.scopes,
        env,
      });
      await store.save(result.apiKey);
      idToHash.set(result.apiKey.id, result.apiKey.keyHash);
      return { apiKey: result.apiKey, plaintext: result.plaintext };
    },
    async revoke(apiKeyId) {
      const hash = idToHash.get(apiKeyId);
      if (!hash) return;
      const existing = await store.findByHash(hash);
      if (!existing) return;
      await store.save(revokeApiKeyRecord(existing));
    },
  };
}

/** File adapter backed by the real {@link FileDeliveryService}. */
function buildFileClient(deps: DeliveryWiringDeps): FileGrantor {
  const service = new FileDeliveryService(deps.fileGrantStore ?? new InMemoryGrantStore(), {
    baseUrl: deps.config.fileDelivery.baseUrl,
    secret: deps.config.fileDelivery.secret,
    defaultExpiresInSec: deps.config.fileDelivery.defaultExpiresInSec,
    defaultMaxDownloads: deps.config.fileDelivery.defaultMaxDownloads,
  });
  return {
    async grant(input) {
      const issued = await service.issueDownload({
        file: { id: input.fileId },
        customerId: input.customerId,
      });
      return {
        fileId: input.fileId,
        url: issued.url,
        expiresAt: new Date(issued.grant.expiresAt * 1000).toISOString(),
      };
    },
    async revoke(input) {
      await service.revokeFileOnRefund(input.fileId, "delivery_rollback");
    },
  };
}

/**
 * SaaS adapter. Provisioning a SaaS entitlement is a pure feature-flag write;
 * we mint an entitlement id and echo the resolved features so the action run
 * captures exactly what was provisioned.
 */
function buildSaasClient(): SaasEntitler {
  const granted = new Map<string, Record<string, boolean | number | string>>();
  return {
    async entitle(input) {
      granted.set(input.entitlementId, { ...input.features });
      return { entitlementId: input.entitlementId, features: { ...input.features } };
    },
    async revoke(input) {
      granted.delete(input.entitlementId);
    },
  };
}

/** Webhook adapter backed by the real signed-delivery-with-retry path. */
function buildWebhookClient(deps: DeliveryWiringDeps): WebhookSender {
  return {
    async send(input) {
      const event = buildWebhookEvent(input.eventType, input.payload, {
        organizationId: input.organizationId,
      });
      const outcome = await deliverWithRetry({
        endpoint: {
          id: generateId("webhookEndpoint"),
          organizationId: input.organizationId,
          url: input.url,
          signingSecret: deps.webhookSigningSecret,
          enabledEvents: [input.eventType],
          active: true,
          createdAt: toIso(new Date()),
        },
        event,
        schedule: [0],
        ...(deps.webhookSender ? { sender: deps.webhookSender } : {}),
      });
      const last = outcome.attempts.at(-1);
      if (!outcome.ok) {
        throw new Error(`Webhook delivery to ${input.url} failed with status ${last?.result.status ?? 0}`);
      }
      return { url: input.url, status: last?.result.status ?? 200, eventId: event.id };
    },
  };
}

/** Email adapter backed by the real `@settlekit/notifications` client. */
function buildEmailClient(deps: DeliveryWiringDeps): EmailSender {
  const client = createEmailClient({
    from: deps.config.email.from,
    ...(deps.emailTransport ? { transport: deps.emailTransport } : { apiKey: deps.config.email.apiKey }),
  });
  return {
    async send(input) {
      const subject = String(input.variables.subject ?? `Your ${input.template}`);
      const html = String(
        input.variables.html ??
          `<p>Template <strong>${input.template}</strong> for organization ${input.organizationId}.</p>`,
      );
      const result = await client.send({ to: input.to, subject, html });
      return { messageId: result.id, to: input.to, template: input.template };
    },
  };
}

/**
 * Construct the full set of concrete delivery clients. Built once at boot and
 * threaded into every {@link DeliveryContext}.
 */
export function createDeliveryClients(deps: DeliveryWiringDeps): DeliveryClients {
  return {
    github: buildGithubClient(deps),
    discord: buildDiscordClient(deps),
    license: buildLicenseClient(deps),
    apiKey: buildApiKeyClient(deps),
    file: buildFileClient(deps),
    saas: buildSaasClient(),
    webhook: buildWebhookClient(deps),
    email: buildEmailClient(deps),
  };
}

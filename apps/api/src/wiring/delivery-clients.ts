/**
 * Real delivery clients for the API — the bridge between the pure
 * {@link DeliveryClients} interfaces in `@settlekit/delivery` and the REAL
 * package implementations (`@settlekit/github`, `@settlekit/discord`,
 * `@settlekit/license-keys`, `@settlekit/api-keys`, `@settlekit/file-delivery`,
 * `@settlekit/saas`, `@settlekit/webhooks`, `@settlekit/notifications`).
 *
 * Adapted verbatim from the worker's `createDeliveryClients`
 * (apps/worker/src/wiring/delivery-clients.ts). The only API-specific change is
 * grant persistence: the worker writes to `WorkerStores`; here the caller
 * injects `upsertGithubGrant` / `upsertDiscordGrant` callbacks (the integrations
 * layer defaults them to simple in-memory maps). The GitHub/Discord low-level
 * transports are injected so the same adapters drive real Octokit / fetch
 * clients in production and in-memory doubles otherwise.
 */

import {
  generateId,
  toIso,
  type DiscordRoleGrant,
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
  addToTeam,
  removeFromTeam,
  type GitHubApi,
} from "@settlekit/github";
import {
  grantDiscordRole,
  revokeDiscordRole,
  type DiscordApi,
} from "@settlekit/discord";
import { LicenseService, InMemoryLicenseStore } from "@settlekit/license-keys";
import {
  ApiKeyService,
  InMemoryApiKeyStore,
  issueApiKey,
  revoke as revokeApiKeyRecord,
  type ApiKeyEnv,
} from "@settlekit/api-keys";
import { FileDeliveryService, InMemoryGrantStore } from "@settlekit/file-delivery";
import { buildWebhookEvent, deliverWithRetry, type HttpSender } from "@settlekit/webhooks";
import { createEmailClient } from "@settlekit/notifications";

/** Grant-persistence callbacks injected by the integrations layer. */
export interface DeliveryGrantSink {
  upsertGithubGrant(grant: GitHubRepoAccessGrant): void;
  upsertDiscordGrant(grant: DiscordRoleGrant): void;
  /** Locate an existing Discord grant for an idempotent revoke. */
  findDiscordGrant(ref: { guildId: string; roleId: string; discordUserId: string }): DiscordRoleGrant | undefined;
}

/** Everything the wiring needs to build the concrete delivery clients. */
export interface DeliveryWiringDeps {
  /** Real `GitHubApi` (Octokit-backed in prod; in-memory otherwise). */
  githubApi: GitHubApi;
  /** Real `DiscordApi` (fetch-backed in prod; in-memory otherwise). */
  discordApi: DiscordApi;
  /** License-key signing secret. */
  licenseTokenSecret: string;
  /** File-delivery signed-URL configuration. */
  fileDelivery: {
    baseUrl: string;
    secret: string;
    defaultExpiresInSec: number;
    defaultMaxDownloads: number;
  };
  /** HMAC secret used to sign outbound `webhook_send` actions. */
  webhookSigningSecret: string;
  /** Where issued grants are persisted (in-memory maps by default). */
  grants: DeliveryGrantSink;
  /** Email transport/credentials. When neither is set the email adapter is omitted. */
  email?: { from: string; apiKey?: string; transport?: Parameters<typeof createEmailClient>[0]["transport"] };
  /** Optional injected HTTP sender for outbound webhooks (omit to use real fetch). */
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
      deps.grants.upsertGithubGrant(grant);
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
      deps.grants.upsertGithubGrant(grant);
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
      deps.grants.upsertDiscordGrant(grant);
      if (grant.status === "failed") {
        throw new Error(`Discord role grant failed for user ${input.discordUserId} in guild ${input.guildId}`);
      }
      return grant;
    },
    async removeRole(input) {
      const existing = deps.grants.findDiscordGrant({
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
      deps.grants.upsertDiscordGrant(revoked);
    },
  };
}

/** License adapter backed by the real {@link LicenseService}. */
function buildLicenseClient(deps: DeliveryWiringDeps): LicenseIssuer {
  const service = new LicenseService(new InMemoryLicenseStore(), {
    tokenSecret: deps.licenseTokenSecret,
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

/** API-key adapter backed by the real `issueApiKey` + an in-memory store. */
function buildApiKeyClient(): ApiKeyIssuer {
  const store = new InMemoryApiKeyStore();
  const service = new ApiKeyService(store);
  const idToHash = new Map<string, string>();
  void service;
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
  const service = new FileDeliveryService(new InMemoryGrantStore(), {
    baseUrl: deps.fileDelivery.baseUrl,
    secret: deps.fileDelivery.secret,
    defaultExpiresInSec: deps.fileDelivery.defaultExpiresInSec,
    defaultMaxDownloads: deps.fileDelivery.defaultMaxDownloads,
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
 * SaaS adapter. Provisioning a SaaS entitlement is a pure feature-flag write; we
 * echo the resolved features so the action run captures what was provisioned.
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
  const cfg = deps.email;
  const client = createEmailClient({
    from: cfg?.from ?? "SettleKit <receipts@settlekit.dev>",
    ...(cfg?.transport ? { transport: cfg.transport } : { apiKey: cfg?.apiKey ?? "" }),
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
 * threaded into the delivery handlers via the app context.
 */
export function createDeliveryClients(deps: DeliveryWiringDeps): DeliveryClients {
  return {
    github: buildGithubClient(deps),
    discord: buildDiscordClient(deps),
    license: buildLicenseClient(deps),
    apiKey: buildApiKeyClient(),
    file: buildFileClient(deps),
    saas: buildSaasClient(),
    webhook: buildWebhookClient(deps),
    email: buildEmailClient(deps),
  };
}

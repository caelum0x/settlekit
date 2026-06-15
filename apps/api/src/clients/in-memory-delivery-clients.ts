/**
 * In-process implementations of the `@settlekit/delivery` `DeliveryClients`,
 * used when no live GitHub/Discord transport is configured.
 *
 * The transport-bound clients (github, discord) and the side-effect-free ones
 * (saas, webhook, email) are deterministic in-process doubles. The three
 * issued-artifact clients (license, API key, file) run the REAL package
 * services backed by the shared stores passed in {@link InMemoryDeliveryOptions}
 * — so a license/API key/file grant issued through delivery is persisted to the
 * same store the `/v1/license-keys`, `/v1/api-keys`, and `/v1/files` routes
 * read, and is immediately verifiable. With no stores supplied they fall back to
 * fresh in-memory stores (self-contained for tests).
 */
import {
  generateId,
  toIso,
  type DiscordRoleGrant,
  type GitHubRepoAccessGrant,
} from "@settlekit/common";
import {
  LicenseService,
  InMemoryLicenseStore,
  type LicenseStore,
} from "@settlekit/license-keys";
import {
  InMemoryApiKeyStore,
  issueApiKey,
  revoke as revokeApiKeyRecord,
  type ApiKeyStore,
} from "@settlekit/api-keys";
import {
  FileDeliveryService,
  InMemoryGrantStore,
  type GrantStore,
} from "@settlekit/file-delivery";
import type { DeliveryClients } from "@settlekit/delivery";

/** Shared stores + secrets the issued-artifact clients persist through. */
export interface InMemoryDeliveryOptions {
  /** License-key signing secret. */
  licenseTokenSecret: string;
  /** File-delivery signed-URL configuration. */
  fileDelivery: {
    baseUrl: string;
    secret: string;
    defaultExpiresInSec: number;
    defaultMaxDownloads: number;
  };
  /** Shared persistence (defaults to fresh in-memory stores). */
  licenseStore?: LicenseStore;
  apiKeyStore?: ApiKeyStore;
  fileGrantStore?: GrantStore;
}

function ghGrant(
  base: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    installationId: number;
    githubUsername: string;
  },
  repoOwner: string,
  repoName: string,
): GitHubRepoAccessGrant {
  return {
    id: generateId("githubRepoAccess"),
    organizationId: base.organizationId,
    installationId: base.installationId,
    customerId: base.customerId,
    entitlementId: base.entitlementId,
    repoOwner,
    repoName,
    githubUsername: base.githubUsername,
    status: "active",
    createdAt: toIso(new Date()),
  };
}

/** Build a fully-wired in-process {@link DeliveryClients}. */
export function createInMemoryDeliveryClients(options: InMemoryDeliveryOptions): DeliveryClients {
  // Real services for the three verifiable artifacts, backed by shared stores.
  const licenseService = new LicenseService(
    options.licenseStore ?? new InMemoryLicenseStore(),
    { tokenSecret: options.licenseTokenSecret },
  );
  const apiKeyStore = options.apiKeyStore ?? new InMemoryApiKeyStore();
  const apiKeyIdToHash = new Map<string, string>();
  const fileService = new FileDeliveryService(
    options.fileGrantStore ?? new InMemoryGrantStore(),
    options.fileDelivery,
  );

  return {
    github: {
      async inviteCollaborator(input) {
        return { ...ghGrant(input, input.repoOwner, input.repoName), status: "invited", invitationId: 42 };
      },
      async removeCollaborator() {
        /* idempotent no-op */
      },
      async addTeamMembership(input) {
        return ghGrant(input, input.orgLogin, input.teamSlug);
      },
      async removeTeamMembership() {
        /* idempotent no-op */
      },
    },
    discord: {
      async addRole(input): Promise<DiscordRoleGrant> {
        return {
          id: generateId("discordRoleAccess"),
          organizationId: input.organizationId,
          guildId: input.guildId,
          roleId: input.roleId,
          customerId: input.customerId,
          entitlementId: input.entitlementId,
          discordUserId: input.discordUserId,
          status: "active",
          createdAt: toIso(new Date()),
        };
      },
      async removeRole() {
        /* idempotent no-op */
      },
    },
    license: {
      async issue(input) {
        return licenseService.issue({
          organizationId: input.organizationId,
          customerId: input.customerId,
          productId: input.productId,
          entitlementId: input.entitlementId,
          machineLimit: 3,
        });
      },
      async revoke(licenseKeyId) {
        await licenseService.revoke(licenseKeyId);
      },
    },
    apiKey: {
      async issue(input) {
        const result = issueApiKey({
          organizationId: input.organizationId,
          customerId: input.customerId,
          productId: input.productId,
          entitlementId: input.entitlementId,
          scopes: input.scopes,
          env: "live",
        });
        await apiKeyStore.save(result.apiKey);
        apiKeyIdToHash.set(result.apiKey.id, result.apiKey.keyHash);
        return { apiKey: result.apiKey, plaintext: result.plaintext };
      },
      async revoke(apiKeyId) {
        const hash = apiKeyIdToHash.get(apiKeyId);
        if (!hash) return;
        const existing = await apiKeyStore.findByHash(hash);
        if (!existing) return;
        await apiKeyStore.save(revokeApiKeyRecord(existing));
      },
    },
    file: {
      async grant(input) {
        const issued = await fileService.issueDownload({
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
        await fileService.revokeFileOnRefund(input.fileId, "delivery_rollback");
      },
    },
    saas: {
      async entitle(input) {
        return { entitlementId: input.entitlementId, features: { ...input.features } };
      },
      async revoke() {
        /* no-op */
      },
    },
    webhook: {
      async send(input) {
        return { url: input.url, status: 200, eventId: generateId("webhookEvent") };
      },
    },
    email: {
      async send(input) {
        return { messageId: generateId("webhookEvent"), to: input.to, template: input.template };
      },
    },
  };
}

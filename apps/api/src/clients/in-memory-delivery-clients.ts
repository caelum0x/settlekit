/**
 * Real, in-process implementations of the `@settlekit/delivery` `DeliveryClients`.
 *
 * These let the API execute delivery action handlers (webhook_send, email_send,
 * and friends) end-to-end without external services. Each client returns the
 * exact shape the corresponding handler expects. They are deterministic and have
 * no side effects beyond their own return values — production swaps these for
 * live GitHub / Discord / email clients.
 */
import {
  generateId,
  generateSecret,
  toIso,
  type ApiKey,
  type DiscordRoleGrant,
  type GitHubRepoAccessGrant,
  type LicenseKey,
} from "@settlekit/common";
import type { DeliveryClients } from "@settlekit/delivery";

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
export function createInMemoryDeliveryClients(): DeliveryClients {
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
      async issue(input): Promise<LicenseKey> {
        return {
          id: generateId("licenseKey"),
          organizationId: input.organizationId,
          customerId: input.customerId,
          productId: input.productId,
          entitlementId: input.entitlementId,
          key: generateSecret(16),
          status: "active",
          machineLimit: 3,
          activatedMachineIds: [],
          activatedDomains: [],
          createdAt: toIso(new Date()),
        };
      },
      async revoke() {
        /* no-op */
      },
    },
    apiKey: {
      async issue(input): Promise<{ apiKey: ApiKey; plaintext: string }> {
        const plaintext = `sk_test_${generateSecret(18)}`;
        const apiKey: ApiKey = {
          id: generateId("apiKey"),
          organizationId: input.organizationId,
          customerId: input.customerId,
          productId: input.productId,
          entitlementId: input.entitlementId,
          keyHash: generateSecret(32),
          keyPrefix: plaintext.slice(0, 16),
          scopes: input.scopes,
          status: "active",
          createdAt: toIso(new Date()),
        };
        return { apiKey, plaintext };
      },
      async revoke() {
        /* no-op */
      },
    },
    file: {
      async grant(input) {
        return {
          fileId: input.fileId,
          url: `https://files.settlekit.local/${input.fileId}`,
          expiresAt: toIso(new Date(Date.now() + 3_600_000)),
        };
      },
      async revoke() {
        /* no-op */
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

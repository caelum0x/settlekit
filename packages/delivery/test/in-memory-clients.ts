/**
 * In-memory implementations of the delivery client interfaces. These are real
 * test doubles of OUR interfaces (not fakes of GitHub/Discord behaviour): they
 * record calls and let tests drive the pure runner/registry/retry domain logic.
 */

import { generateId, generateSecret, toIso } from "@settlekit/common";
import type {
  ApiKey,
  DiscordRoleGrant,
  GitHubRepoAccessGrant,
  LicenseKey,
} from "@settlekit/common";
import type {
  ApiKeyIssuer,
  DeliveryClients,
  DiscordRoleClient,
  EmailDelivery,
  EmailSender,
  FileAccessGrant,
  FileGrantor,
  GithubAccessClient,
  IssuedApiKey,
  LicenseIssuer,
  SaasEntitlementGrant,
  SaasEntitler,
  WebhookDelivery,
  WebhookSender,
} from "../src/clients.js";

/** A client whose nth call can be forced to throw, to exercise retry/rollback. */
export interface FailController {
  /** Number of leading calls that should throw before succeeding. */
  failTimes?: number;
  /** When true, the error is non-retryable (`retryable: false`). */
  nonRetryable?: boolean;
  /** When set, the client always throws (never recovers). */
  alwaysFail?: boolean;
}

class Failer {
  private calls = 0;
  constructor(private readonly ctrl: FailController = {}) {}

  maybeThrow(label: string): void {
    this.calls += 1;
    const { failTimes = 0, alwaysFail = false, nonRetryable = false } = this.ctrl;
    const shouldFail = alwaysFail || this.calls <= failTimes;
    if (shouldFail) {
      const err = new Error(`${label} failed (call ${this.calls})`) as Error & {
        retryable?: boolean;
      };
      if (nonRetryable) err.retryable = false;
      throw err;
    }
  }
}

export class InMemoryGithub implements GithubAccessClient {
  readonly invited: GitHubRepoAccessGrant[] = [];
  readonly removed: Array<Record<string, unknown>> = [];
  readonly teamAdded: GitHubRepoAccessGrant[] = [];
  readonly teamRemoved: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async inviteCollaborator(
    input: Parameters<GithubAccessClient["inviteCollaborator"]>[0],
  ): Promise<GitHubRepoAccessGrant> {
    this.failer.maybeThrow("inviteCollaborator");
    const grant: GitHubRepoAccessGrant = {
      id: generateId("githubRepoAccess"),
      organizationId: input.organizationId,
      installationId: input.installationId,
      customerId: input.customerId,
      entitlementId: input.entitlementId,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      githubUsername: input.githubUsername,
      invitationId: 100 + this.invited.length,
      status: "invited",
      createdAt: toIso(new Date()),
    };
    this.invited.push(grant);
    return grant;
  }

  async removeCollaborator(
    input: Parameters<GithubAccessClient["removeCollaborator"]>[0],
  ): Promise<void> {
    this.removed.push({ ...input });
  }

  async addTeamMembership(
    input: Parameters<GithubAccessClient["addTeamMembership"]>[0],
  ): Promise<GitHubRepoAccessGrant> {
    this.failer.maybeThrow("addTeamMembership");
    const grant: GitHubRepoAccessGrant = {
      id: generateId("githubRepoAccess"),
      organizationId: input.organizationId,
      installationId: input.installationId,
      customerId: input.customerId,
      entitlementId: input.entitlementId,
      repoOwner: input.orgLogin,
      repoName: input.teamSlug,
      githubUsername: input.githubUsername,
      status: "active",
      createdAt: toIso(new Date()),
    };
    this.teamAdded.push(grant);
    return grant;
  }

  async removeTeamMembership(
    input: Parameters<GithubAccessClient["removeTeamMembership"]>[0],
  ): Promise<void> {
    this.teamRemoved.push({ ...input });
  }
}

export class InMemoryDiscord implements DiscordRoleClient {
  readonly added: DiscordRoleGrant[] = [];
  readonly removed: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async addRole(input: Parameters<DiscordRoleClient["addRole"]>[0]): Promise<DiscordRoleGrant> {
    this.failer.maybeThrow("addRole");
    const grant: DiscordRoleGrant = {
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
    this.added.push(grant);
    return grant;
  }

  async removeRole(input: Parameters<DiscordRoleClient["removeRole"]>[0]): Promise<void> {
    this.removed.push({ ...input });
  }
}

export class InMemoryLicense implements LicenseIssuer {
  readonly issued: LicenseKey[] = [];
  readonly revoked: string[] = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async issue(input: Parameters<LicenseIssuer["issue"]>[0]): Promise<LicenseKey> {
    this.failer.maybeThrow("license.issue");
    const license: LicenseKey = {
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
    this.issued.push(license);
    return license;
  }

  async revoke(licenseKeyId: string): Promise<void> {
    this.revoked.push(licenseKeyId);
  }
}

export class InMemoryApiKey implements ApiKeyIssuer {
  readonly issued: ApiKey[] = [];
  readonly revoked: string[] = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async issue(input: Parameters<ApiKeyIssuer["issue"]>[0]): Promise<IssuedApiKey> {
    this.failer.maybeThrow("apiKey.issue");
    const plaintext = `sk_live_${generateSecret(16)}`;
    const apiKey: ApiKey = {
      id: generateId("apiKey"),
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      entitlementId: input.entitlementId,
      keyHash: `hash_${plaintext.slice(-8)}`,
      keyPrefix: plaintext.slice(0, 12),
      scopes: input.scopes,
      status: "active",
      createdAt: toIso(new Date()),
    };
    this.issued.push(apiKey);
    return { apiKey, plaintext };
  }

  async revoke(apiKeyId: string): Promise<void> {
    this.revoked.push(apiKeyId);
  }
}

export class InMemoryFile implements FileGrantor {
  readonly granted: FileAccessGrant[] = [];
  readonly revoked: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async grant(input: Parameters<FileGrantor["grant"]>[0]): Promise<FileAccessGrant> {
    this.failer.maybeThrow("file.grant");
    const grant: FileAccessGrant = {
      fileId: input.fileId,
      url: `https://cdn.example.com/${input.fileId}?sig=${generateSecret(8)}`,
      expiresAt: toIso(new Date(Date.now() + 3_600_000)),
    };
    this.granted.push(grant);
    return grant;
  }

  async revoke(input: Parameters<FileGrantor["revoke"]>[0]): Promise<void> {
    this.revoked.push({ ...input });
  }
}

export class InMemorySaas implements SaasEntitler {
  readonly entitled: SaasEntitlementGrant[] = [];
  readonly revoked: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async entitle(input: Parameters<SaasEntitler["entitle"]>[0]): Promise<SaasEntitlementGrant> {
    this.failer.maybeThrow("saas.entitle");
    const grant: SaasEntitlementGrant = {
      entitlementId: input.entitlementId,
      features: input.features,
    };
    this.entitled.push(grant);
    return grant;
  }

  async revoke(input: Parameters<SaasEntitler["revoke"]>[0]): Promise<void> {
    this.revoked.push({ ...input });
  }
}

export class InMemoryWebhook implements WebhookSender {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async send(input: Parameters<WebhookSender["send"]>[0]): Promise<WebhookDelivery> {
    this.failer.maybeThrow("webhook.send");
    this.sent.push({ ...input });
    return { url: input.url, status: 200, eventId: generateId("webhookEvent") };
  }
}

export class InMemoryEmail implements EmailSender {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly failer: Failer;
  constructor(ctrl?: FailController) {
    this.failer = new Failer(ctrl);
  }

  async send(input: Parameters<EmailSender["send"]>[0]): Promise<EmailDelivery> {
    this.failer.maybeThrow("email.send");
    this.sent.push({ ...input });
    return { messageId: generateId("webhookEvent"), to: input.to, template: input.template };
  }
}

/** Bundle of all in-memory clients, with handles to assert against in tests. */
export interface InMemorySuite {
  clients: DeliveryClients;
  github: InMemoryGithub;
  discord: InMemoryDiscord;
  license: InMemoryLicense;
  apiKey: InMemoryApiKey;
  file: InMemoryFile;
  saas: InMemorySaas;
  webhook: InMemoryWebhook;
  email: InMemoryEmail;
}

/** Build a full suite of in-memory clients. Pass per-client fail controllers. */
export function createInMemorySuite(controllers: {
  github?: FailController;
  discord?: FailController;
  license?: FailController;
  apiKey?: FailController;
  file?: FailController;
  saas?: FailController;
  webhook?: FailController;
  email?: FailController;
} = {}): InMemorySuite {
  const github = new InMemoryGithub(controllers.github);
  const discord = new InMemoryDiscord(controllers.discord);
  const license = new InMemoryLicense(controllers.license);
  const apiKey = new InMemoryApiKey(controllers.apiKey);
  const file = new InMemoryFile(controllers.file);
  const saas = new InMemorySaas(controllers.saas);
  const webhook = new InMemoryWebhook(controllers.webhook);
  const email = new InMemoryEmail(controllers.email);
  return {
    clients: { github, discord, license, apiKey, file, saas, webhook, email },
    github,
    discord,
    license,
    apiKey,
    file,
    saas,
    webhook,
    email,
  };
}

/**
 * Integration assembly for the API.
 *
 * Turns an {@link ApiConfig} into the concrete clients the routes depend on.
 * For each integration group: when its credentials are present, the REAL package
 * client is constructed; otherwise the existing in-memory double from
 * `src/clients/` is used so the API boots end-to-end with no external infra.
 *
 * Grant persistence for the delivery adapters is kept "real" without requiring a
 * database: simple in-memory maps back the `DeliveryGrantSink`. Callers that
 * have stores can pass their own sink via {@link BuildIntegrationsOptions}.
 */

import { money, type DiscordRoleGrant, type GitHubRepoAccessGrant } from "@settlekit/common";
import {
  createArcClient,
  getArcChain,
  isArcAsset,
  type ArcAddress,
  type ArcClient,
} from "@settlekit/arc";
import { createWalletsClient } from "@settlekit/circle-wallets";
import { createScreeningClient, type ScreeningClient } from "@settlekit/compliance";
import {
  createCircleWalletsPayoutExecutor,
  type PayoutExecutor,
} from "../payouts/executor.js";
import {
  OctokitGitHubApi,
  createGitHubAccessClient,
  type GitHubAccessClient,
} from "@settlekit/github";
import { createDiscordClient, type DiscordApi } from "@settlekit/discord";
import { createCircleClient, type CircleClient } from "@settlekit/circle";
import { createEmailClient, type EmailClient } from "@settlekit/notifications";
import type { LicenseStore } from "@settlekit/license-keys";
import type { ApiKeyStore } from "@settlekit/api-keys";
import type { GrantStore } from "@settlekit/file-delivery";
import type { DeliveryClients } from "@settlekit/delivery";
import type { PaymentVerifier } from "@settlekit/x402";
import type { ApiConfig } from "./env.js";
import {
  createDeliveryClients,
  type DeliveryGrantSink,
} from "../wiring/delivery-clients.js";
import { createInMemoryDeliveryClients } from "../clients/in-memory-delivery-clients.js";
import { InMemoryGitHubAccessClient } from "../clients/in-memory-github-client.js";
import { InMemoryDiscordApi } from "../clients/in-memory-discord-client.js";

/** The fully-resolved set of integration clients used by the routes. */
export interface Integrations {
  /** Concrete delivery clients (real transports when configured). */
  deliveryClients: DeliveryClients;
  /** High-level GitHub access client (real Octokit-backed or in-memory). */
  githubAccessClient: GitHubAccessClient;
  /** Discord API (real fetch-backed bot or in-memory). */
  discordApi: DiscordApi;
  /** Arc settlement verifier for x402 paid calls, or null when Arc is unset. */
  arcVerifier: PaymentVerifier | null;
  /** Raw Arc client (verify / fee-estimate / confirmations), or null when unset. */
  arc: ArcClient | null;
  /** Real Circle REST client, or null when Circle is unset. */
  circle: CircleClient | null;
  /** Real payout executor (Circle wallets), or null when unset. */
  payoutExecutor: PayoutExecutor | null;
  /** Circle compliance address-screening client, or null when unset. */
  screening: ScreeningClient | null;
  /** Real email client, or null when email is unset. */
  email: EmailClient | null;
}

/** Optional injection points for {@link buildIntegrations}. */
export interface BuildIntegrationsOptions {
  /** Override grant persistence (defaults to in-memory maps). */
  grantSink?: DeliveryGrantSink;
  /**
   * Shared stores for issued access artifacts. The app context passes its own
   * license / API-key / file-grant stores so delivery-issued keys land where the
   * verify/list routes read them. Omitted -> fresh in-memory stores.
   */
  licenseStore?: LicenseStore;
  apiKeyStore?: ApiKeyStore;
  fileGrantStore?: GrantStore;
}

/** A `DeliveryGrantSink` backed by plain in-memory maps. */
function createInMemoryGrantSink(): DeliveryGrantSink {
  const githubGrants = new Map<string, GitHubRepoAccessGrant>();
  const discordGrants = new Map<string, DiscordRoleGrant>();
  return {
    async upsertGithubGrant(grant) {
      githubGrants.set(grant.id, grant);
    },
    async upsertDiscordGrant(grant) {
      discordGrants.set(grant.id, grant);
    },
    async findDiscordGrant(ref) {
      for (const grant of discordGrants.values()) {
        if (
          grant.guildId === ref.guildId &&
          grant.roleId === ref.roleId &&
          grant.discordUserId === ref.discordUserId
        ) {
          return grant;
        }
      }
      return undefined;
    },
  };
}

/**
 * Build an x402 {@link PaymentVerifier} over a real {@link ArcClient}. Confirms
 * the proof's transaction transferred at least the advertised amount to the
 * configured `payTo` address with enough confirmations.
 */
function buildArcVerifier(arc: ArcClient, minConfirmations: number): PaymentVerifier {
  const chain = getArcChain(arc.config.chainId);

  return async (proof, requirements) => {
    if (proof.network !== "arc") {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(proof.txHash)) {
      return { ok: false, reason: "Malformed transaction hash" };
    }

    const txHash = proof.txHash as `0x${string}`;
    const to = requirements.payTo as ArcAddress;
    const minAmount = money(requirements.amount, requirements.asset);
    // Widen to string: requirements.asset is typed as the literal "USDC", but
    // EURC/USYC settlements flow through the same verifier at runtime.
    const asset: string = requirements.asset;

    // Resolve which token to look for. USDC uses the configured USDC address;
    // other Arc stablecoins (EURC/USYC) resolve their contract from the chain
    // definition so they settle through the same on-chain verification path.
    let result;
    if (asset === "USDC") {
      result = await arc.verifyUsdcTransfer({ txHash, to, minAmount });
    } else if (chain && isArcAsset(asset) && chain.tokens[asset]) {
      result = await arc.verifyTokenTransfer({
        txHash,
        token: chain.tokens[asset].address,
        to,
        minAmount,
      });
    } else {
      return { ok: false, reason: `Unsupported settlement asset on Arc: ${asset}` };
    }

    if (!result.confirmed) {
      return { ok: false, reason: `No matching ${asset} transfer found` };
    }
    if (result.confirmations < minConfirmations) {
      return {
        ok: false,
        reason: `Insufficient confirmations: ${result.confirmations} < ${minConfirmations}`,
      };
    }
    return { ok: true };
  };
}

/**
 * Construct the full set of {@link Integrations} from an {@link ApiConfig}.
 * Each group falls back to its in-memory double when its creds are absent.
 */
export function buildIntegrations(
  config: ApiConfig,
  options: BuildIntegrationsOptions = {},
): Integrations {
  // Real GitHub App transport (Octokit) when configured; reused for both the
  // high-level access client and the delivery adapters.
  const githubApi = config.github
    ? OctokitGitHubApi.fromAppCredentials({
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        installationId: config.github.installationId,
      })
    : null;

  const githubAccessClient: GitHubAccessClient = githubApi
    ? createGitHubAccessClient(githubApi)
    : new InMemoryGitHubAccessClient();

  // Real fetch-backed Discord bot when configured; reused likewise.
  const discordApi: DiscordApi = config.discord
    ? createDiscordClient({
        botToken: config.discord.botToken,
        auditReason: "SettleKit access automation",
      })
    : new InMemoryDiscordApi();

  // Delivery clients: real adapters only when BOTH github + discord transports
  // are configured; otherwise the in-memory delivery clients keep the API whole.
  // Shared issued-artifact stores: when the context passes its own license /
  // API-key / file-grant stores, keys issued by delivery are persisted where the
  // verify/list routes read them.
  const sharedStores = {
    ...(options.licenseStore ? { licenseStore: options.licenseStore } : {}),
    ...(options.apiKeyStore ? { apiKeyStore: options.apiKeyStore } : {}),
    ...(options.fileGrantStore ? { fileGrantStore: options.fileGrantStore } : {}),
  };

  let deliveryClients: DeliveryClients;
  if (githubApi && config.github && config.discord) {
    const grants = options.grantSink ?? createInMemoryGrantSink();
    deliveryClients = createDeliveryClients({
      githubApi,
      discordApi,
      licenseTokenSecret: config.licenseTokenSecret,
      fileDelivery: config.fileDelivery,
      webhookSigningSecret: config.webhookSigningSecret,
      grants,
      ...sharedStores,
      ...(config.email
        ? { email: { from: config.email.from, apiKey: config.email.apiKey } }
        : {}),
    });
  } else {
    deliveryClients = createInMemoryDeliveryClients({
      licenseTokenSecret: config.licenseTokenSecret,
      fileDelivery: config.fileDelivery,
      ...sharedStores,
    });
  }

  const arcClient = config.arc
    ? createArcClient({
        rpcUrl: config.arc.rpcUrl,
        usdcAddress: config.arc.usdcAddress,
        chainId: config.arc.chainId,
      })
    : null;
  const arcVerifier =
    arcClient && config.arc ? buildArcVerifier(arcClient, config.arc.minConfirmations) : null;

  const circle = config.circle
    ? createCircleClient({
        apiKey: config.circle.apiKey,
        ...(config.circle.baseUrl ? { baseUrl: config.circle.baseUrl } : {}),
      })
    : null;

  // Real payout execution over Circle developer-controlled wallets. The entity
  // secret (when configured statically) is supplied per mutating call via the
  // client's provider hook; otherwise the caller supplies it per request.
  const payoutExecutor = config.circleWallets
    ? createCircleWalletsPayoutExecutor(
        createWalletsClient({
          apiKey: config.circleWallets.apiKey,
          ...(config.circleWallets.baseUrl ? { baseUrl: config.circleWallets.baseUrl } : {}),
          ...(config.circleWallets.entitySecretCiphertext
            ? { entitySecretProvider: () => config.circleWallets!.entitySecretCiphertext! }
            : {}),
        }),
        { sourceWalletId: config.circleWallets.walletId },
      )
    : null;

  const screening = config.compliance
    ? createScreeningClient({
        apiKey: config.compliance.apiKey,
        ...(config.compliance.baseUrl ? { baseUrl: config.compliance.baseUrl } : {}),
      })
    : null;

  const email = config.email
    ? createEmailClient({ from: config.email.from, apiKey: config.email.apiKey })
    : null;

  return {
    deliveryClients,
    githubAccessClient,
    discordApi,
    arcVerifier,
    arc: arcClient,
    circle,
    payoutExecutor,
    screening,
    email,
  };
}

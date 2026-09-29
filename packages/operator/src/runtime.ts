/**
 * Assemble a complete operator runtime (store, vault executors, engine,
 * screening, x402, notifications, intake, policy admin) from configuration.
 * Used by the API routes and the worker job; tests inject parts directly.
 *
 * Without OPERATOR_VAULT_ADDRESS the runtime uses the in-memory
 * LocalExecutor and reports `executor: "local-simulation"` so nothing is
 * ever presented as on-chain when it is not.
 */
import { createArcClient } from "@settlekit/arc";
import { createFetchWalletsHttp, createWalletsClient, DEFAULT_W3S_BASE_URL, type WalletsClient } from "@settlekit/circle-wallets";
import { createScreeningClient } from "@settlekit/compliance";
import { createConnection } from "@settlekit/database";
import { createEmailClient } from "@settlekit/notifications";
import { createCircleWalletSettler } from "@settlekit/x402-client";
import Anthropic from "@anthropic-ai/sdk";
import { BillIntake, ClaudeInvoiceExtractor } from "./bills.js";
import { createEntitySecretProvider } from "./circle-entity-secret.js";
import type { DecisionEngine, X402Gateway } from "./context.js";
import { createOperatorAgent } from "./engine.js";
import { EscalationQueue } from "./escalation.js";
import type { OperatorExecutor, OwnerExecutor, VaultStateReader } from "./executor.js";
import { createStoreHistory } from "./history.js";
import { LocalExecutor } from "./local-executor.js";
import { createDiscordWebhookChannel, createEmailChannel, createEscalationNotifier, type AlertChannel } from "./notifier.js";
import { PgOperatorStore, type SqlClient } from "./pg-store.js";
import { PolicyAdmin } from "./policy-admin.js";
import { computeProof, type OperatorProof } from "./proof.js";
import { loadOperatorConfig, type Env, type OperatorConfig, type SignerConfig } from "./runtime-config.js";
import { createCounterpartyScreener } from "./screening.js";
import { OperatorService } from "./service.js";
import { InMemoryOperatorStore, type OperatorStore } from "./store.js";
import { arcChain, createArcPublicClient, createArcWalletClient } from "./vault-clients.js";
import { VaultExecutor, type VaultPublicClient } from "./vault-executor.js";
import { createDcwVaultTransport, createViemVaultTransport, type VaultTransport } from "./vault-transport.js";
import { findDecision, verifyDecision, type DecisionVerification, type ReceiptSource } from "./verify.js";
import { createX402Gateway } from "./x402.js";

export type ExecutorKind = "circle-dcw" | "viem-signer" | "local-simulation";

export interface OperatorRuntime {
  readonly config: OperatorConfig;
  readonly store: OperatorStore;
  readonly service: OperatorService;
  readonly policy: PolicyAdmin;
  readonly intake: BillIntake;
  readonly executorKind: ExecutorKind;
  readonly engineName: string;
  proof(): Promise<OperatorProof>;
  verify(decisionId: string): Promise<DecisionVerification | null>;
}

export interface RuntimeOverrides {
  readonly store?: OperatorStore;
  readonly engine?: DecisionEngine;
  readonly executor?: OperatorExecutor & VaultStateReader;
  readonly owner?: OwnerExecutor;
  readonly executorKind?: ExecutorKind;
  readonly receipts?: ReceiptSource;
  readonly x402?: X402Gateway;
  readonly channels?: readonly AlertChannel[];
  readonly now?: () => Date;
  readonly onError?: (context: string, error: unknown) => void;
}

function circleWallets(config: OperatorConfig): WalletsClient | null {
  const c = config.circle;
  if (!c?.entitySecret) return null;
  const baseUrl = c.baseUrl ?? DEFAULT_W3S_BASE_URL;
  const http = createFetchWalletsHttp({ apiKey: c.apiKey, baseUrl });
  return createWalletsClient({ apiKey: c.apiKey, baseUrl, http, entitySecretProvider: createEntitySecretProvider(http, c.entitySecret) });
}

function transportFor(signer: SignerConfig, config: OperatorConfig, wallets: WalletsClient | null): VaultTransport {
  const vault = config.vault!.address;
  if (signer.kind === "viem") {
    return createViemVaultTransport({ vault, walletClient: createArcWalletClient(arcChain(config.rpcUrl, config.chainId), signer.privateKey) });
  }
  if (!wallets) throw new Error("Circle DCW signer requires CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
  return createDcwVaultTransport({ wallets, walletAddress: signer.walletAddress, vault });
}

interface Executors {
  readonly executor: OperatorExecutor & VaultStateReader;
  readonly owner?: OwnerExecutor;
  readonly kind: ExecutorKind;
}

function buildExecutors(config: OperatorConfig, store: OperatorStore, wallets: WalletsClient | null, now: () => Date): Executors {
  if (!config.vault) {
    const local = new LocalExecutor({ caps: config.defaults, allowlist: config.defaults.allowlist, now });
    return { executor: local, owner: local, kind: "local-simulation" };
  }
  const client: VaultPublicClient = createArcPublicClient(arcChain(config.rpcUrl, config.chainId));
  const candidates = async (): Promise<readonly string[]> => {
    const stored = await store.getPolicy(config.orgId);
    return (stored ?? config.defaults).allowlist;
  };
  const make = (signer: SignerConfig) => new VaultExecutor({ vault: config.vault!.address, client, transport: transportFor(signer, config, wallets), allowlistCandidates: candidates, now });
  const executor = make(config.vault.operator);
  const owner = config.vault.owner ? make(config.vault.owner) : undefined;
  return { executor, ...(owner ? { owner } : {}), kind: config.vault.operator.kind === "dcw" ? "circle-dcw" : "viem-signer" };
}

function channels(config: OperatorConfig): AlertChannel[] {
  const out: AlertChannel[] = [];
  const a = config.alerts;
  if (a.resendApiKey && a.emailTo.length > 0) {
    out.push(createEmailChannel(createEmailClient({ apiKey: a.resendApiKey, from: a.emailFrom }), a.emailTo));
  }
  if (a.discordWebhookUrl) out.push(createDiscordWebhookChannel(a.discordWebhookUrl));
  return out;
}

export function createOperatorRuntime(env: Env, fallbackOrgId: string, overrides: RuntimeOverrides = {}): OperatorRuntime {
  const config = loadOperatorConfig(env, fallbackOrgId);
  const now = overrides.now ?? (() => new Date());
  const onError = overrides.onError ?? (() => undefined);
  const store = overrides.store ?? (config.databaseUrl ? new PgOperatorStore(createConnection(config.databaseUrl).client as unknown as SqlClient) : new InMemoryOperatorStore());
  const wallets = circleWallets(config);
  const built = overrides.executor ? { executor: overrides.executor, owner: overrides.owner, kind: overrides.executorKind ?? ("local-simulation" as ExecutorKind) } : buildExecutors(config, store, wallets, now);
  const policy = new PolicyAdmin({ store, defaults: config.defaults, vault: built.executor });
  const history = createStoreHistory(store);
  const x402 = overrides.x402 ?? (config.x402 && wallets
    ? createX402Gateway({
        settler: createCircleWalletSettler({ wallets, walletId: config.x402.walletId, tokenId: config.x402.tokenId, fromAddress: config.x402.walletAddress }),
        from: config.x402.walletAddress,
        store,
        allowedHosts: config.x402.allowedHosts,
      })
    : undefined);
  const notify = createEscalationNotifier(overrides.channels ?? channels(config), {
    ...(config.alerts.consoleUrl ? { consoleUrl: config.alerts.consoleUrl } : {}),
    onError: (channel, error) => onError(`notify:${channel}`, error),
  });
  const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : undefined;
  const engine = overrides.engine ?? createOperatorAgent({ client: anthropic, models: config.models, onFallback: (e) => onError("engine", e) });
  const screener = createCounterpartyScreener({ ...(config.circle ? { screening: createScreeningClient({ apiKey: config.circle.apiKey }) } : {}), history });
  const service = new OperatorService({
    store,
    executor: built.executor,
    ...(built.owner ? { owner: built.owner } : {}),
    policy,
    engine,
    escalations: new EscalationQueue(store, { now, notify }),
    screener,
    history,
    ...(x402 ? { x402 } : {}),
    now,
  });
  const intake = new BillIntake({ service, policy, ...(anthropic ? { extractor: new ClaudeInvoiceExtractor(anthropic, config.models.critical) } : {}), now });
  const receipts = overrides.receipts ?? (config.vault ? createArcClient({ rpcUrl: config.rpcUrl, usdcAddress: config.usdcAddress, chainId: config.chainId }) : undefined);
  return {
    config,
    store,
    service,
    policy,
    intake,
    executorKind: built.kind,
    engineName: engine.name,
    proof: () => computeProof(store, { now: now(), explorerUrl: config.explorerUrl }),
    async verify(decisionId) {
      const record = await findDecision(store, decisionId);
      if (!record) return null;
      return verifyDecision(store, record, {
        ...(receipts ? { receipts } : {}),
        ...(config.vault ? { vault: config.vault.address } : {}),
        explorerUrl: config.explorerUrl,
      });
    },
  };
}

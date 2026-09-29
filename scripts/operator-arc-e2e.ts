/**
 * Live end-to-end run of the SettleKit operator on Arc testnet.
 *
 *   sale -> allocate -> pay a bill -> escalate a bill above the threshold
 *        -> owner approves -> verify every decision against DecisionAnchored
 *
 * Moves real testnet USDC, so it refuses to run without LIVE=1.
 *
 * Env (owner-provided):
 *   LIVE=1
 *   OWNER_PRIVATE_KEY        vault owner; also deploys the vault when needed
 *   PAYER_PRIVATE_KEY        customer wallet funded from faucet.circle.com
 *   VENDOR_ADDRESS           payee for the test bills
 *   Operator signer, one of:
 *     OPERATOR_WALLET_ADDRESS + CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (Circle DCW)
 *     OPERATOR_PRIVATE_KEY (viem signer)
 *   OPERATOR_VAULT_ADDRESS   optional; deployed from contracts/out when unset
 *   ANTHROPIC_API_KEY        optional; heuristic engine when unset
 *   SALE_USDC (default 10), ARC_RPC_URL (default Arc testnet)
 *
 * Run:  LIVE=1 ... apps/api/node_modules/.bin/tsx scripts/operator-arc-e2e.ts
 * (contracts: `forge build` first so the OperatorVault artifact exists)
 */
import { fileURLToPath } from "node:url";
import {
  addressOf,
  arcChain,
  createArcPublicClient,
  createOperatorRuntime,
  createViemVaultTransport,
  createArcWalletClient,
  deployOperatorVault,
  digest,
  loadOperatorConfig,
  parseUsdc,
  policyView,
  transferUsdc,
  usdcBalance,
  VaultExecutor,
  type DecisionRecord,
  type Hex,
  type OperatorRuntime,
} from "../packages/operator/src/index.js";

const CAPS = { perTxCap: parseUsdc("5"), dailyCap: parseUsdc("8"), escalateAbove: parseUsdc("2") };
const ARTIFACT = fileURLToPath(new URL("../contracts/out/OperatorVault.sol/OperatorVault.json", import.meta.url));

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function ensureVault(env: NodeJS.ProcessEnv, ownerKey: Hex): Promise<Hex> {
  if (env.OPERATOR_VAULT_ADDRESS) return env.OPERATOR_VAULT_ADDRESS as Hex;
  const config = loadOperatorConfig({ ...env, OPERATOR_VAULT_ADDRESS: undefined }, "e2e");
  const operator = (env.OPERATOR_WALLET_ADDRESS ?? addressOf(need("OPERATOR_PRIVATE_KEY") as Hex)) as Hex;
  const { address, txHash } = await deployOperatorVault({
    chain: arcChain(config.rpcUrl, config.chainId),
    deployerKey: ownerKey,
    usdc: config.usdcAddress,
    owner: addressOf(ownerKey),
    operator,
    caps: CAPS,
    artifactPath: ARTIFACT,
  });
  say(`deployed OperatorVault ${address} (${config.explorerUrl}/tx/${txHash})`);
  return address;
}

function report(label: string, record: DecisionRecord, explorer: string): void {
  const tx = record.txHash ? ` ${explorer}/tx/${record.txHash}` : "";
  say(`${label}: ${record.outcome} by ${record.model} (decision ${record.id})${tx}`);
}

async function main(): Promise<void> {
  if (process.env.LIVE !== "1") {
    say("Refusing to run: this moves real Arc testnet USDC. Set LIVE=1 to proceed.");
    process.exitCode = 2;
    return;
  }
  const ownerKey = need("OWNER_PRIVATE_KEY") as Hex;
  const payerKey = need("PAYER_PRIVATE_KEY") as Hex;
  const vendor = need("VENDOR_ADDRESS").toLowerCase() as Hex;
  const vault = await ensureVault(process.env, ownerKey);
  const env = { ...process.env, OPERATOR_VAULT_ADDRESS: vault, OPERATOR_ALLOWLIST: vendor, OPERATOR_ORG_ID: "e2e", DATABASE_URL: process.env.OPERATOR_E2E_DATABASE_URL };
  const runtime: OperatorRuntime = createOperatorRuntime(env, "e2e", { onError: (c, e) => say(`warn ${c}: ${e instanceof Error ? e.message : String(e)}`) });
  const { config } = runtime;
  const chain = arcChain(config.rpcUrl, config.chainId);
  say(`vault ${vault} executor=${runtime.executorKind} engine=${runtime.engineName}`);

  // Owner configures the guard rails on-chain, then the matching off-chain policy.
  const owner = new VaultExecutor({ vault, client: createArcPublicClient(chain), transport: createViemVaultTransport({ vault, walletClient: createArcWalletClient(chain, ownerKey) }) });
  await owner.setCaps(digest({ e2e: "caps", CAPS }), CAPS);
  await owner.setAllowlist(digest({ e2e: "allowlist", vendor }), vendor, true);
  const policy = policyView(await runtime.policy.put("e2e", policyView({ ...config.defaults, ...CAPS, allowlist: [vendor] })));
  say(`policy perTx=${policy.perTxCap} daily=${policy.dailyCap} escalateAbove=${policy.escalateAbove}`);

  // 1. A customer pays the vault; the operator allocates the sale.
  const sale = parseUsdc(process.env.SALE_USDC ?? "10");
  const payer = addressOf(payerKey);
  if ((await usdcBalance(chain, config.usdcAddress, payer)) < sale) throw new Error(`payer ${payer} needs ${process.env.SALE_USDC ?? "10"} USDC (faucet.circle.com)`);
  const saleTx = await transferUsdc(chain, payerKey, config.usdcAddress, vault, sale);
  const now = new Date().toISOString();
  const allocation = await runtime.service.handle({ type: "revenue.received", id: `sale:${saleTx}`, orgId: "e2e", at: now, amount: sale, payer, paymentRef: saleTx });
  report("sale allocated", allocation, config.explorerUrl);

  // 2. A small bill is paid directly; 3. a larger one escalates in the vault.
  const small = await runtime.intake.manual("e2e", { payee: vendor, amountUsdc: "1", dueAt: now, description: "testnet mirror of a hosting invoice" });
  report("bill 1 USDC", small.decision!, config.explorerUrl);
  const large = await runtime.intake.manual("e2e", { payee: vendor, amountUsdc: "3", dueAt: now, description: "testnet mirror of a contractor invoice" });
  report("bill 3 USDC", large.decision!, config.explorerUrl);

  // 4. The owner approves the escalation on-chain.
  const [pending] = await runtime.store.listEscalations("e2e", "pending");
  if (!pending) throw new Error("expected a pending escalation for the 3 USDC bill");
  const approval = await runtime.service.approve("e2e", pending.id, addressOf(ownerKey));
  report("owner approval", approval, config.explorerUrl);

  // 5. Verify every decision: chain, commitment, DecisionAnchored on Arc.
  let ok = true;
  for (const record of await runtime.store.listDecisions("e2e")) {
    const v = await runtime.verify(record.id);
    ok = ok && Boolean(v?.valid);
    say(`verify ${record.id}: ${v?.valid ? "valid" : "INVALID"} commitment=${v?.commitment} onChain=${JSON.stringify(v?.onChain)}`);
  }
  say(JSON.stringify(await runtime.proof(), null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

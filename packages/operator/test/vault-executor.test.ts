import { generateKeyPairSync, constants, privateDecrypt } from "node:crypto";
import { createWalletsClient, type WalletsHttp, type WalletsRequest } from "@settlekit/circle-wallets";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";
import { createEntitySecretProvider, encryptEntitySecret, EntitySecretError } from "../src/circle-entity-secret.js";
import { VaultError } from "../src/executor.js";
import { OPERATOR_VAULT_ABI } from "../src/vault-abi.js";
import { VaultExecutor, revertName, type VaultPublicClient, type VaultReceipt } from "../src/vault-executor.js";
import { createDcwVaultTransport, createViemVaultTransport, deterministicUuid, type Hex } from "../src/vault-transport.js";
import { VENDOR } from "./fixtures.js";

const VAULT = "0x00000000000000000000000000000000000000f1" as Hex;
const OPERATOR = "0x00000000000000000000000000000000000000e1" as Hex;
const DECISION = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}` as Hex;

interface FakeChain extends VaultPublicClient {
  readonly simulated: Array<{ functionName: string; args: readonly unknown[]; account: string }>;
  revertWith: string | null;
  receipt: VaultReceipt;
}

function fakeChain(state: Record<string, unknown> = {}): FakeChain {
  const chain: FakeChain = {
    simulated: [],
    revertWith: null,
    receipt: { status: "success", logs: [] },
    async readContract({ functionName, args }) {
      if (functionName === "allowlisted") return (args?.[0] as string).toLowerCase() === VENDOR;
      if (!(functionName in state)) throw new Error(`no fake value for ${functionName}`);
      return state[functionName];
    },
    async simulateContract({ functionName, args, account }) {
      chain.simulated.push({ functionName, args, account });
      if (chain.revertWith) throw Object.assign(new Error("execution reverted"), { cause: { data: { errorName: chain.revertWith } } });
      return {};
    },
    async waitForTransactionReceipt() {
      return chain.receipt;
    },
  };
  return chain;
}

function escalatedLog(id: bigint): VaultReceipt["logs"][number] {
  const topics = encodeEventTopics({ abi: OPERATOR_VAULT_ABI, eventName: "Escalated", args: { id, decisionHash: DECISION as Hex, to: VENDOR as Hex } });
  const data = encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }], [0, 600_000_000n]);
  return { address: VAULT, topics: topics as Hex[], data };
}

/** Fake Circle W3S HTTP: records requests, completes transactions on first poll. */
function fakeCircle(): { http: WalletsHttp; requests: WalletsRequest[] } {
  const requests: WalletsRequest[] = [];
  const http: WalletsHttp = {
    async request(req) {
      requests.push(req);
      if (req.method === "POST" && req.path.endsWith("/contractExecution")) {
        return { status: 201, body: { data: { id: "tx_1", state: "INITIATED" } } };
      }
      if (req.method === "GET" && req.path.startsWith("/v1/w3s/transactions/")) {
        const polls = requests.filter((r) => r.method === "GET").length;
        const state = polls < 2 ? "SENT" : "COMPLETE";
        return { status: 200, body: { data: { transaction: { id: "tx_1", blockchain: "ARC-TESTNET", state, txHash: state === "COMPLETE" ? TX : undefined, createDate: "", updateDate: "" } } } };
      }
      return { status: 404, body: { message: "not found" } };
    },
  };
  return { http, requests };
}

function dcwExecutor(chain: FakeChain) {
  const circle = fakeCircle();
  const wallets = createWalletsClient({ apiKey: "k", http: circle.http, entitySecretProvider: () => "cipher" });
  const transport = createDcwVaultTransport({ wallets, walletAddress: OPERATOR, vault: VAULT, sleep: async () => undefined });
  return { circle, executor: new VaultExecutor({ vault: VAULT, client: chain, transport, allowlistCandidates: async () => [VENDOR, "0x0000000000000000000000000000000000000bad"] }) };
}

describe("VaultExecutor over Circle DCW contract execution", () => {
  it("allocates via contractExecution with Circle-shaped parameters and polls to COMPLETE", async () => {
    const chain = fakeChain();
    const { circle, executor } = dcwExecutor(chain);
    const result = await executor.allocate(DECISION, { OPERATING: 700n, TAX: 250n, YIELD: 25n, REFUND: 25n });
    expect(result.txHash).toBe(TX);
    const post = circle.requests[0]!;
    expect(post.path).toBe("/v1/w3s/developer/transactions/contractExecution");
    expect(post.body).toMatchObject({
      walletAddress: OPERATOR,
      blockchain: "ARC-TESTNET",
      contractAddress: VAULT,
      abiFunctionSignature: "allocate(bytes32,uint256[4])",
      abiParameters: [DECISION, ["700", "250", "25", "25"]],
      feeLevel: "MEDIUM",
      entitySecretCiphertext: "cipher",
    });
    expect((post.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(chain.simulated[0]).toMatchObject({ functionName: "allocate", account: OPERATOR });
    expect(circle.requests.filter((r) => r.method === "GET")).toHaveLength(2);
  });

  it("reports a vault escalation id from the Escalated log", async () => {
    const chain = fakeChain();
    chain.receipt = { status: "success", logs: [{ address: "0x0000000000000000000000000000000000000999", topics: [], data: "0x" }, escalatedLog(7n)] };
    const { executor, circle } = dcwExecutor(chain);
    const result = await executor.pay(DECISION, "OPERATING", VENDOR, 600_000_000n);
    expect(result).toEqual({ txHash: TX, status: "escalated", escalationId: 7 });
    expect((circle.requests[0]!.body as { abiParameters: unknown[] }).abiParameters).toEqual([DECISION, "0", VENDOR, "600000000"]);
  });

  it("refuses without sending when the simulation reverts with a vault error", async () => {
    const chain = fakeChain();
    chain.revertWith = "NotAllowlisted";
    const { executor, circle } = dcwExecutor(chain);
    await expect(executor.pay(DECISION, "OPERATING", VENDOR, 1n)).rejects.toMatchObject({ code: "NotAllowlisted" });
    await expect(executor.pay(DECISION, "OPERATING", VENDOR, 1n)).rejects.toBeInstanceOf(VaultError);
    expect(circle.requests).toHaveLength(0);
    chain.revertWith = "NotOperator";
    await expect(executor.approve(1)).rejects.toThrow(/NotOperator/);
  });

  it("fails loudly on a reverted receipt", async () => {
    const chain = fakeChain();
    chain.receipt = { status: "reverted", logs: [] };
    const { executor } = dcwExecutor(chain);
    await expect(executor.sweepToYield(DECISION, 5n)).rejects.toThrow(/reverted/);
  });

  it("snapshots buckets, pause, yield, today's spend and the on-chain allowlist", async () => {
    const chain = fakeChain({
      buckets: [700n, 250n, 25n, 25n],
      unallocated: 10n,
      pendingReserved: 0n,
      yieldDeployed: 3n,
      yieldAdapter: "0x00000000000000000000000000000000000000a9",
      paused: false,
      spentToday: 42n,
      perTxCap: 1000n,
      dailyCap: 1500n,
      escalateAbove: 500n,
    });
    const at = new Date("2026-10-04T12:00:00Z");
    const executor = new VaultExecutor({ vault: VAULT, client: chain, transport: { sender: OPERATOR, send: async () => ({ txHash: TX }) }, allowlistCandidates: async () => [VENDOR, "0x0000000000000000000000000000000000000bad"], now: () => at });
    const snap = await executor.snapshot();
    expect(snap).toMatchObject({ unallocated: 10n, yieldEnabled: true, paused: false, allowlist: [VENDOR], spends: [{ amount: 42n, at: at.toISOString() }] });
    expect(snap.buckets).toEqual({ OPERATING: 700n, TAX: 250n, YIELD: 25n, REFUND: 25n });
    expect(await executor.caps()).toEqual({ perTxCap: 1000n, dailyCap: 1500n, escalateAbove: 500n });
  });
});

describe("viem signer transport", () => {
  it("sends writeContract with the vault ABI and owner account", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const owner = "0x00000000000000000000000000000000000000c1" as Hex;
    const transport = createViemVaultTransport({ vault: VAULT, walletClient: { account: { address: owner }, writeContract: async (a) => { calls.push(a); return TX; } } });
    const chain = fakeChain();
    const executor = new VaultExecutor({ vault: VAULT, client: chain, transport });
    expect(await executor.setCaps(DECISION, { perTxCap: 10n, dailyCap: 20n, escalateAbove: 5n })).toEqual({ txHash: TX });
    await executor.pause();
    await executor.reject(3);
    expect(calls.map((c) => c.functionName)).toEqual(["setCaps", "pause", "reject"]);
    expect(calls[2]!.args).toEqual([3n]);
    expect(chain.simulated.every((s) => s.account === owner)).toBe(true);
    expect(() => createViemVaultTransport({ vault: VAULT, walletClient: { account: undefined, writeContract: async () => TX } })).toThrow(/no account/);
  });

  it("derives stable RFC 4122 v4-shaped idempotency keys", () => {
    expect(deterministicUuid("a")).toBe(deterministicUuid("a"));
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
  });

  it("finds custom error names in nested causes", () => {
    expect(revertName({ cause: { cause: { errorName: "TaxLocked" } } })).toBe("TaxLocked");
    expect(revertName(new Error("x"))).toBeNull();
  });
});

describe("Circle entity secret ciphertext", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const secret = "11".repeat(32);

  it("encrypts with RSA-OAEP SHA-256, fresh per call, fetching the key once", async () => {
    let fetches = 0;
    const http: WalletsHttp = { request: async () => { fetches += 1; return { status: 200, body: { data: { publicKey: pem } } }; } };
    const provider = createEntitySecretProvider(http, secret);
    const a = await provider();
    const b = await provider();
    expect(a).not.toBe(b);
    expect(fetches).toBe(1);
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(a, "base64"));
    expect(plain.toString("hex")).toBe(secret);
  });

  it("rejects malformed secrets and surfaces key fetch failures", async () => {
    expect(() => encryptEntitySecret("zz", pem)).toThrow(EntitySecretError);
    const provider = createEntitySecretProvider({ request: async () => ({ status: 401, body: null }) }, secret);
    await expect(provider()).rejects.toThrow(/status 401/);
  });
});

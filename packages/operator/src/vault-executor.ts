/**
 * VaultExecutor — the real OperatorVault on Arc behind the executor interfaces.
 *
 * Reads go through a viem public client. Every write is first simulated as
 * the signing address, so a call the vault would revert is refused without
 * spending gas and surfaces as `VaultError(<custom error>)` — the same codes
 * the policy mirrors. The write is then sent through a `VaultTransport`
 * (Circle DCW contract execution, or a viem key), the receipt is awaited and
 * `pay` reads the `Escalated` log to report vault escalations.
 */
import { decodeEventLog } from "viem";
import { toVaultAmounts } from "./allocation.js";
import {
  VaultError,
  type OperatorExecutor,
  type OwnerExecutor,
  type PayResult,
  type TxResult,
  type VaultCaps,
  type VaultErrorCode,
  type VaultStateReader,
} from "./executor.js";
import { bucketIndex, type Bucket, type BucketBalances, type VaultSnapshot } from "./types.js";
import { OPERATOR_VAULT_ABI, type VaultCall } from "./vault-abi.js";
import type { Hex, VaultTransport } from "./vault-transport.js";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

const VAULT_ERRORS: ReadonlySet<string> = new Set<VaultErrorCode>([
  "IsPaused", "ZeroAddress", "ZeroAmount", "TaxLocked", "NotAllowlisted", "PerTxCapExceeded", "DailyCapExceeded",
  "InsufficientBucket", "OverAllocation", "InvalidCaps", "YieldDisabled", "InsufficientYield", "NotPending",
  "EscalationExpired", "EscalationNotExpired",
]);

export interface ReceiptLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface VaultReceipt {
  readonly status: "success" | "reverted";
  readonly logs: readonly ReceiptLog[];
}

/** The slice of a viem PublicClient the executor uses. */
export interface VaultPublicClient {
  readContract(args: { address: Hex; abi: typeof OPERATOR_VAULT_ABI; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  simulateContract(args: { address: Hex; abi: typeof OPERATOR_VAULT_ABI; functionName: string; args: readonly unknown[]; account: Hex }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<VaultReceipt>;
}

export interface VaultExecutorOptions {
  readonly vault: Hex;
  readonly client: VaultPublicClient;
  readonly transport: VaultTransport;
  /** Payees to check against the on-chain allowlist when snapshotting. */
  readonly allowlistCandidates?: () => Promise<readonly string[]>;
  readonly now?: () => Date;
}

/** Find a Solidity custom error name anywhere in a viem error's cause chain. */
export function revertName(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 10; depth++) {
    const data = (current as { data?: { errorName?: unknown } }).data;
    if (data && typeof data.errorName === "string") return data.errorName;
    const direct = (current as { errorName?: unknown }).errorName;
    if (typeof direct === "string") return direct;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export class VaultExecutor implements OperatorExecutor, OwnerExecutor, VaultStateReader {
  private readonly now: () => Date;

  constructor(private readonly options: VaultExecutorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private read<T>(functionName: string, args?: readonly unknown[]): Promise<T> {
    return this.options.client.readContract({ address: this.options.vault, abi: OPERATOR_VAULT_ABI, functionName, ...(args ? { args } : {}) }) as Promise<T>;
  }

  async snapshot(): Promise<VaultSnapshot> {
    const [raw, unallocated, pendingReserved, yieldDeployed, adapter, paused, spentToday] = await Promise.all([
      this.read<readonly bigint[]>("buckets"),
      this.read<bigint>("unallocated"),
      this.read<bigint>("pendingReserved"),
      this.read<bigint>("yieldDeployed"),
      this.read<string>("yieldAdapter"),
      this.read<boolean>("paused"),
      this.read<bigint>("spentToday"),
    ]);
    const candidates = this.options.allowlistCandidates ? await this.options.allowlistCandidates() : [];
    const flags = await Promise.all(candidates.map((c) => this.isAllowlisted(c)));
    const buckets: BucketBalances = Object.freeze({
      OPERATING: raw[0] ?? 0n,
      TAX: raw[1] ?? 0n,
      YIELD: raw[2] ?? 0n,
      REFUND: raw[3] ?? 0n,
    });
    return Object.freeze({
      buckets,
      unallocated,
      pendingReserved,
      yieldDeployed,
      yieldEnabled: adapter.toLowerCase() !== ZERO_ADDRESS,
      paused,
      allowlist: candidates.filter((_, i) => flags[i]).map((c) => c.toLowerCase()),
      spends: spentToday > 0n ? [{ amount: spentToday, at: this.now().toISOString() }] : [],
    });
  }

  async caps(): Promise<VaultCaps> {
    const [perTxCap, dailyCap, escalateAbove] = await Promise.all([
      this.read<bigint>("perTxCap"),
      this.read<bigint>("dailyCap"),
      this.read<bigint>("escalateAbove"),
    ]);
    return { perTxCap, dailyCap, escalateAbove };
  }

  isAllowlisted(payee: string): Promise<boolean> {
    return this.read<boolean>("allowlisted", [payee]);
  }

  /** Simulate as the signer, send, and wait for a successful receipt. */
  private async write(call: VaultCall): Promise<{ readonly txHash: Hex; readonly receipt: VaultReceipt }> {
    const { client, vault, transport } = this.options;
    try {
      await client.simulateContract({ address: vault, abi: OPERATOR_VAULT_ABI, functionName: call.functionName, args: call.args, account: transport.sender });
    } catch (error) {
      const name = revertName(error);
      if (name && VAULT_ERRORS.has(name)) throw new VaultError(name as VaultErrorCode);
      throw new Error(`OperatorVault.${call.functionName} simulation failed: ${name ?? (error instanceof Error ? error.message : String(error))}`);
    }
    const { txHash } = await transport.send(call);
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`OperatorVault.${call.functionName} reverted in ${txHash}`);
    return { txHash, receipt };
  }

  async allocate(decisionHash: string, amounts: BucketBalances): Promise<TxResult> {
    const { txHash } = await this.write({ functionName: "allocate", args: [decisionHash, toVaultAmounts(amounts)] });
    return { txHash };
  }

  async pay(decisionHash: string, bucket: Bucket, to: string, amount: bigint): Promise<PayResult> {
    const { txHash, receipt } = await this.write({ functionName: "pay", args: [decisionHash, bucketIndex(bucket), to, amount] });
    const escalationId = escalatedId(receipt, this.options.vault);
    return escalationId === null ? { txHash, status: "paid" } : { txHash, status: "escalated", escalationId };
  }

  async sweepToYield(decisionHash: string, amount: bigint): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "sweepToYield", args: [decisionHash, amount] })).txHash };
  }

  async redeemFromYield(decisionHash: string, amount: bigint): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "redeemFromYield", args: [decisionHash, amount] })).txHash };
  }

  async approve(escalationId: number): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "approve", args: [BigInt(escalationId)] })).txHash };
  }

  async reject(escalationId: number): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "reject", args: [BigInt(escalationId)] })).txHash };
  }

  async expire(escalationId: number): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "expire", args: [BigInt(escalationId)] })).txHash };
  }

  async setCaps(decisionHash: string, caps: VaultCaps): Promise<TxResult> {
    const args = [decisionHash, caps.perTxCap, caps.dailyCap, caps.escalateAbove];
    return { txHash: (await this.write({ functionName: "setCaps", args })).txHash };
  }

  async setAllowlist(decisionHash: string, payee: string, allowed: boolean): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "setAllowlist", args: [decisionHash, payee, allowed] })).txHash };
  }

  async pause(): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "pause", args: [] })).txHash };
  }

  async unpause(): Promise<TxResult> {
    return { txHash: (await this.write({ functionName: "unpause", args: [] })).txHash };
  }
}

/** The vault escalation id from an `Escalated` log, or null when paid. */
export function escalatedId(receipt: VaultReceipt, vault: string): number | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: OPERATOR_VAULT_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (decoded.eventName === "Escalated") return Number(decoded.args.id);
    } catch {
      // A vault log of another event type (DecisionAnchored, Paid): not an escalation.
      continue;
    }
  }
  return null;
}


/**
 * How signed vault calls reach Arc.
 *
 * - `createDcwVaultTransport`: Circle developer-controlled wallet contract
 *   execution (`createContractExecution`, built by
 *   `buildContractExecutionRequest`) polled to COMPLETE with
 *   `pollTransaction`. The operator's DCW address is the vault `operator`.
 * - `createViemVaultTransport`: a local private-key signer via viem, for
 *   when DCW cannot target the chain (or for the owner key in scripts).
 *
 * Idempotency keys are derived from the call, so a retried request can never
 * submit the same vault action twice.
 */
import { createHash } from "node:crypto";
import { pollTransaction, type CreateContractExecutionInput, type WalletsClient } from "@settlekit/circle-wallets";
import type { CircleBlockchain } from "@settlekit/circle-wallets";
import { OPERATOR_VAULT_ABI, VAULT_SIGNATURES, toCircleParameters, type VaultCall } from "./vault-abi.js";

export type Hex = `0x${string}`;

export interface VaultTransport {
  /** Address that signs (must be the vault operator or owner). */
  readonly sender: Hex;
  send(call: VaultCall): Promise<{ readonly txHash: Hex }>;
}

export class VaultTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultTransportError";
  }
}

/** Deterministic RFC 4122 v4-shaped UUID from arbitrary input. */
export function deterministicUuid(input: string): string {
  const h = createHash("sha256").update(input).digest("hex");
  const variant = ((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DcwVaultTransportOptions {
  readonly wallets: Pick<WalletsClient, "createContractExecution" | "getTransaction">;
  /** DCW wallet address that signs (operator or owner wallet). */
  readonly walletAddress: Hex;
  readonly vault: Hex;
  readonly blockchain?: CircleBlockchain;
  readonly feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  readonly pollAttempts?: number;
  readonly pollDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createDcwVaultTransport(options: DcwVaultTransportOptions): VaultTransport {
  const blockchain = options.blockchain ?? "ARC-TESTNET";
  return {
    sender: options.walletAddress,
    async send(call) {
      const abiParameters = toCircleParameters(call.args);
      const key = `${options.vault}:${options.walletAddress}:${VAULT_SIGNATURES[call.functionName]}:${JSON.stringify(abiParameters)}`;
      const input: CreateContractExecutionInput = {
        walletAddress: options.walletAddress,
        blockchain,
        contractAddress: options.vault,
        abiFunctionSignature: VAULT_SIGNATURES[call.functionName],
        // Circle takes array-typed ABI params (uint256[4]) as nested JSON arrays.
        abiParameters: abiParameters as CreateContractExecutionInput["abiParameters"],
        feeLevel: options.feeLevel ?? "MEDIUM",
        refId: `operator:${call.functionName}`,
        idempotencyKey: deterministicUuid(key),
      };
      const created = await options.wallets.createContractExecution(input);
      const done = await pollTransaction(options.wallets, {
        id: created.id,
        attempts: options.pollAttempts,
        delayMs: options.pollDelayMs,
        sleep: options.sleep,
      });
      if (!done.txHash) throw new VaultTransportError(`Circle transaction ${created.id} completed without a txHash`);
      return { txHash: done.txHash as Hex };
    },
  };
}

/** The slice of a viem WalletClient the transport uses. */
export interface VaultWalletClient {
  readonly account?: { readonly address: Hex } | undefined;
  writeContract(args: {
    address: Hex;
    abi: typeof OPERATOR_VAULT_ABI;
    functionName: VaultCall["functionName"];
    args: readonly unknown[];
    account?: unknown;
    chain?: unknown;
  }): Promise<Hex>;
}

export interface ViemVaultTransportOptions {
  readonly walletClient: VaultWalletClient;
  readonly vault: Hex;
  readonly chain?: unknown;
}

export function createViemVaultTransport(options: ViemVaultTransportOptions): VaultTransport {
  const account = options.walletClient.account;
  if (!account) throw new VaultTransportError("viem wallet client has no account");
  return {
    sender: account.address,
    async send(call) {
      const txHash = await options.walletClient.writeContract({
        address: options.vault,
        abi: OPERATOR_VAULT_ABI,
        functionName: call.functionName,
        args: call.args,
        account,
        chain: options.chain ?? null,
      });
      return { txHash };
    },
  };
}

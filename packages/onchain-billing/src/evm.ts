/**
 * The EVM seam every onchain-billing module talks through.
 *
 * {@link EvmOperator} is one operator hot key on one chain: typed reads,
 * contract writes that resolve to a tx hash, receipt waits and EIP-712
 * signature checks (EOA recovery plus ERC-1271 / ERC-6492 for smart wallets,
 * via viem's public-action `verifyTypedData`). Tests inject an in-memory
 * double that simulates the contracts; production uses {@link createViemOperator}.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Chain,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  hyperEvm,
  hyperliquidEvmTestnet,
  mainnet,
  robinhood,
  robinhoodTestnet,
  sepolia,
  tempo,
  tempoModerato,
} from "viem/chains";
import type { Hex } from "@settlekit/chains";
import { ChargeDeclinedError, IndeterminateChargeError, errorMessage } from "./provider.js";

export interface ContractCall {
  address: Hex;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export interface TxReceipt {
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
}

export interface EvmOperator {
  /** The operator hot key's address (msg.sender of every write). */
  readonly address: Hex;
  readonly chainId: number;
  read<T = unknown>(call: ContractCall): Promise<T>;
  /** Simulate then submit; resolves with the tx hash once broadcast. */
  write(call: ContractCall): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<TxReceipt>;
  /** Receipt when mined, null when unknown/pending (reconciliation). */
  getReceipt(hash: Hex): Promise<TxReceipt | null>;
  /** EIP-712 check for EOAs and smart wallets (ERC-1271 / ERC-6492). */
  verifyTypedData(args: { address: Hex; signature: Hex } & TypedDataDefinition): Promise<boolean>;
  /** Latest block timestamp (seconds), used for period math against chain time. */
  blockTimestamp(): Promise<bigint>;
}

const VIEM_CHAINS: ReadonlyMap<number, Chain> = new Map<number, Chain>(
  [
    mainnet,
    sepolia,
    base,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
    hyperEvm,
    hyperliquidEvmTestnet,
    robinhood,
    robinhoodTestnet,
    tempo,
    tempoModerato,
  ].map((chain) => [chain.id, chain] as const),
);

/** Tempo has no native gas token: fees are paid in a USD TIP-20. */
const TEMPO_CHAIN_IDS = new Set([4217, 42431]);

export interface ViemOperatorConfig {
  chainId: number;
  rpcUrl: string;
  privateKey: Hex;
  /** Tempo only: TIP-20 used for gas (defaults to the billed token). */
  feeToken?: Hex;
}

function chainFor(config: ViemOperatorConfig): Chain {
  const known = VIEM_CHAINS.get(config.chainId);
  if (!known) throw new Error(`no viem chain definition for chain id ${config.chainId}`);
  const withRpc: Chain = { ...known, rpcUrls: { default: { http: [config.rpcUrl] } } };
  if (!TEMPO_CHAIN_IDS.has(config.chainId) || config.feeToken === undefined) return withRpc;
  return { ...withRpc, feeToken: config.feeToken } as Chain;
}

function toReceipt(raw: { transactionHash: Hex; status: "success" | "reverted"; blockNumber: bigint }): TxReceipt {
  return { transactionHash: raw.transactionHash, status: raw.status, blockNumber: raw.blockNumber };
}

/** A real operator: viem public + wallet clients over one private key. */
export function createViemOperator(config: ViemOperatorConfig): EvmOperator {
  const chain = chainFor(config);
  const transport = http(config.rpcUrl);
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  return {
    address: account.address,
    chainId: config.chainId,
    async read<T>(call: ContractCall): Promise<T> {
      return (await publicClient.readContract(call as never)) as T;
    },
    async write(call) {
      const { request } = await publicClient.simulateContract({ ...call, account } as never);
      return wallet.writeContract(request as never);
    },
    async waitForReceipt(hash) {
      return toReceipt(await publicClient.waitForTransactionReceipt({ hash }));
    },
    async getReceipt(hash) {
      try {
        return toReceipt(await publicClient.getTransactionReceipt({ hash }));
      } catch {
        return null;
      }
    },
    verifyTypedData(args) {
      return publicClient.verifyTypedData(args as never);
    },
    async blockTimestamp() {
      const block = await publicClient.getBlock({ blockTag: "latest" });
      return block.timestamp;
    },
  };
}

/** Throw when a mined transaction reverted. */
export async function writeAndConfirm(operator: EvmOperator, call: ContractCall): Promise<TxReceipt> {
  const hash = await operator.write(call);
  const receipt = await operator.waitForReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error(`${call.functionName} transaction ${hash} reverted`);
  }
  return receipt;
}

/**
 * Wait for a broadcast charge transaction. A revert is a definite decline; a
 * wait that fails (timeout, RPC outage) is indeterminate — the tx may still
 * land, so the charge must be reconciled later instead of re-sent.
 */
export async function confirmCharge(operator: EvmOperator, hash: Hex, label: string): Promise<TxReceipt> {
  let receipt: TxReceipt;
  try {
    receipt = await operator.waitForReceipt(hash);
  } catch (error) {
    throw new IndeterminateChargeError(`${label} ${hash} broadcast but not confirmed: ${errorMessage(error)}`);
  }
  if (receipt.status !== "success") throw new ChargeDeclinedError(`${label} ${hash} reverted`);
  return receipt;
}

/**
 * Live Arc helpers for deployment and end-to-end runs: deploy OperatorVault
 * from the Foundry artifact, move testnet USDC, and derive signer addresses.
 * Every function performs real transactions; nothing here runs in tests
 * without an injected client.
 */
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, parseAbi, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VaultCaps } from "./executor.js";
import type { Hex } from "./vault-transport.js";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const CONSTRUCTOR_ABI = parseAbi([
  "constructor(address token_, address owner_, address operator_, uint256 perTxCap_, uint256 dailyCap_, uint256 escalateAbove_)",
]);

export function addressOf(privateKey: Hex): Hex {
  return privateKeyToAccount(privateKey).address;
}

export interface DeployVaultInput {
  readonly chain: Chain;
  readonly deployerKey: Hex;
  readonly usdc: Hex;
  readonly owner: Hex;
  readonly operator: Hex;
  readonly caps: VaultCaps;
  /** Path to contracts/out/OperatorVault.sol/OperatorVault.json (run `forge build`). */
  readonly artifactPath: string;
}

export async function deployOperatorVault(input: DeployVaultInput): Promise<{ readonly address: Hex; readonly txHash: Hex }> {
  const artifact = JSON.parse(await readFile(input.artifactPath, "utf8")) as { bytecode?: { object?: string } };
  const bytecode = artifact.bytecode?.object;
  if (!bytecode || !bytecode.startsWith("0x")) throw new Error(`no bytecode in ${input.artifactPath}; run forge build in contracts/`);
  const account = privateKeyToAccount(input.deployerKey);
  const wallet = createWalletClient({ account, chain: input.chain, transport: http() });
  const reader = createPublicClient({ chain: input.chain, transport: http() });
  const txHash = await wallet.deployContract({
    abi: CONSTRUCTOR_ABI,
    bytecode: bytecode as Hex,
    args: [input.usdc, input.owner, input.operator, input.caps.perTxCap, input.caps.dailyCap, input.caps.escalateAbove],
  });
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`vault deployment failed in ${txHash}`);
  return { address: receipt.contractAddress, txHash };
}

export async function transferUsdc(chain: Chain, key: Hex, usdc: Hex, to: Hex, amount: bigint): Promise<Hex> {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const reader = createPublicClient({ chain, transport: http() });
  const txHash = await wallet.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "transfer", args: [to, amount] });
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`USDC transfer reverted in ${txHash}`);
  return txHash;
}

export async function usdcBalance(chain: Chain, usdc: Hex, owner: Hex): Promise<bigint> {
  const reader = createPublicClient({ chain, transport: http() });
  return reader.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

/**
 * Browser EVM wallet helpers (client-safe, no React): EIP-6963 wallet
 * discovery, EIP-3085/3326 chain switching with the 4902 "unknown chain"
 * fallback, and the ERC-20 / TIP-20 transfer call the buyer's wallet signs.
 *
 * Kept free of DOM globals so each step is unit tested with fakes.
 */
import { encodeFunctionData, type Abi, type Account, type Address, type WalletClient } from "viem";

export type Hex = `0x${string}`;

/** Minimal EIP-1193 provider surface we call. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

/** EIP-6963 provider info (https://eips.ethereum.org/EIPS/eip-6963). */
export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  /** data: URI image. Anything else is dropped. */
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

export const EIP6963_ANNOUNCE = "eip6963:announceProvider";
export const EIP6963_REQUEST = "eip6963:requestProvider";

const SAFE_ICON_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i;

/** Validate an announced detail; null when malformed. Unsafe icons are blanked. */
export function parseAnnouncement(detail: unknown): Eip6963ProviderDetail | null {
  if (detail === null || typeof detail !== "object") return null;
  const { info, provider } = detail as { info?: Partial<Eip6963ProviderInfo>; provider?: Partial<Eip1193Provider> };
  if (!info || typeof info.uuid !== "string" || info.uuid.length === 0) return null;
  if (typeof info.name !== "string" || info.name.trim().length === 0) return null;
  if (!provider || typeof provider.request !== "function") return null;
  return {
    info: {
      uuid: info.uuid,
      name: info.name.trim().slice(0, 64),
      icon: typeof info.icon === "string" && SAFE_ICON_RE.test(info.icon) ? info.icon : "",
      rdns: typeof info.rdns === "string" ? info.rdns : "",
    },
    provider: provider as Eip1193Provider,
  };
}

/** Add an announcement to a list, de-duplicated by uuid (latest wins). */
export function addAnnouncement(list: readonly Eip6963ProviderDetail[], detail: unknown): Eip6963ProviderDetail[] {
  const parsed = parseAnnouncement(detail);
  if (parsed === null) return [...list];
  return [...list.filter((entry) => entry.info.uuid !== parsed.info.uuid), parsed];
}

/** The subset of `window` discovery needs. */
export interface DiscoveryTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
}

/**
 * Subscribe to EIP-6963 announcements and ask wallets to announce. `onChange`
 * gets the full de-duplicated list on every new announcement. Returns the
 * unsubscribe function.
 */
export function watchEip6963Wallets(
  target: DiscoveryTarget,
  onChange: (wallets: Eip6963ProviderDetail[]) => void,
): () => void {
  let wallets: Eip6963ProviderDetail[] = [];
  const listener = (event: Event) => {
    const next = addAnnouncement(wallets, (event as CustomEvent<unknown>).detail);
    if (next.length !== wallets.length || next.some((entry, index) => entry !== wallets[index])) {
      wallets = next;
      onChange(wallets);
    }
  };
  target.addEventListener(EIP6963_ANNOUNCE, listener);
  target.dispatchEvent(new Event(EIP6963_REQUEST));
  return () => target.removeEventListener(EIP6963_ANNOUNCE, listener);
}

/** Legacy injected provider (window.ethereum) as a pseudo-announcement. */
export function legacyInjectedWallet(ethereum: unknown): Eip6963ProviderDetail | null {
  if (!ethereum || typeof (ethereum as Partial<Eip1193Provider>).request !== "function") return null;
  return {
    info: { uuid: "legacy-injected", name: "Browser wallet", icon: "", rdns: "" },
    provider: ethereum as Eip1193Provider,
  };
}

// --- chain switching ---------------------------------------------------------

/** EIP-3085 `wallet_addEthereumChain` parameter. */
export interface AddEthereumChainParameter {
  chainId: Hex;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

export function toHexChainId(chainId: number): Hex {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError(`invalid chain id ${chainId}`);
  return `0x${chainId.toString(16)}`;
}

export interface AddChainInput {
  chainId: number;
  name: string;
  /** PUBLIC RPC only: this is handed to the buyer's wallet. */
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Explorer tx URL prefix (".../tx/") or null. */
  explorerTxBase: string | null;
}

/**
 * Build the add-chain request. Wallets such as MetaMask reject a native
 * currency that does not use 18 decimals; the value is display-only for them
 * (gas on Tempo is paid in a stablecoin), so it is normalised to 18.
 */
export function buildAddChainParams(input: AddChainInput): AddEthereumChainParameter {
  const explorerRoot = input.explorerTxBase?.replace(/\/tx\/?$/, "");
  return {
    chainId: toHexChainId(input.chainId),
    chainName: input.name,
    nativeCurrency: { ...input.nativeCurrency, decimals: 18 },
    rpcUrls: [input.rpcUrl],
    ...(explorerRoot ? { blockExplorerUrls: [explorerRoot] } : {}),
  };
}

/** Provider error codes, including ones some mobile wallets nest. */
function errorCodes(error: unknown): number[] {
  if (error === null || typeof error !== "object") return [];
  const direct = (error as { code?: unknown }).code;
  const nested = (error as { data?: { originalError?: { code?: unknown } } }).data?.originalError?.code;
  return [direct, nested].filter((code): code is number => typeof code === "number");
}

/** EIP-3326: the wallet does not know the chain yet. */
export function isUnknownChainError(error: unknown): boolean {
  return errorCodes(error).includes(4902);
}

/** EIP-1193: the buyer rejected the request. */
export function isUserRejection(error: unknown): boolean {
  return errorCodes(error).includes(4001);
}

/** Current chain id of the wallet. */
export async function walletChainId(provider: Eip1193Provider): Promise<number> {
  const raw = await provider.request({ method: "eth_chainId" });
  const value = typeof raw === "string" ? Number.parseInt(raw, 16) : Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("wallet returned an invalid chain id");
  return value;
}

/** Switch the wallet to `params.chainId`, adding the chain first when unknown (4902). */
export async function switchOrAddChain(provider: Eip1193Provider, params: AddEthereumChainParameter): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [params] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
  }
}

// --- transfer ------------------------------------------------------------------

export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/** TIP-20 `transferWithMemo(address,uint256,bytes32)` (Tempo). */
export const TIP20_TRANSFER_WITH_MEMO_ABI = [
  {
    type: "function",
    name: "transferWithMemo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "bytes32" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export interface TransferInput {
  token: Hex;
  payTo: Hex;
  amountBase: string;
  /** bytes32 memo; when set, the TIP-20 memo transfer is used. */
  memo: Hex | null;
}

export type TransferCall =
  | { address: Hex; abi: typeof ERC20_TRANSFER_ABI; functionName: "transfer"; args: readonly [Hex, bigint] }
  | {
      address: Hex;
      abi: typeof TIP20_TRANSFER_WITH_MEMO_ABI;
      functionName: "transferWithMemo";
      args: readonly [Hex, bigint, Hex];
    };

/** The contract call that pays the session (exact base units). */
export function buildTransferCall(input: TransferInput): TransferCall {
  if (!/^\d+$/.test(input.amountBase) || BigInt(input.amountBase) <= 0n) {
    throw new RangeError("amountBase must be a positive integer string");
  }
  const amount = BigInt(input.amountBase);
  if (input.memo !== null) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.memo)) throw new RangeError("memo must be bytes32");
    return {
      address: input.token,
      abi: TIP20_TRANSFER_WITH_MEMO_ABI,
      functionName: "transferWithMemo",
      args: [input.payTo, amount, input.memo],
    };
  }
  return { address: input.token, abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [input.payTo, amount] };
}

/** ABI-encoded calldata for a transfer call. */
export function encodeTransferCall(call: TransferCall): Hex {
  return call.functionName === "transferWithMemo"
    ? encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args })
    : encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args });
}

/**
 * Ask the wallet to sign + send the transfer with viem `writeContract`.
 * `chain: null` leaves chain selection to the wallet, which was switched to
 * the session's chain just before (and is re-checked by the caller).
 */
export function sendTransfer(client: WalletClient, account: Address | Account, call: TransferCall): Promise<Hex> {
  if (call.functionName === "transferWithMemo") {
    return client.writeContract({ account, chain: null, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args });
  }
  return client.writeContract({ account, chain: null, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args });
}

// --- mobile wallets (EIP-681) ----------------------------------------------------

export interface Eip681TransferInput {
  token: Hex;
  chainId: number;
  payTo: Hex;
  amountBase: string;
}

/**
 * EIP-681 ERC-20 transfer request for mobile wallets (QR):
 * `ethereum:<token>@<chainId>/transfer?address=<payTo>&uint256=<baseUnits>`.
 * The buyer then pastes the resulting hash; verification is unchanged.
 */
export function buildEip681TransferUri(input: Eip681TransferInput): string {
  if (!/^\d+$/.test(input.amountBase) || BigInt(input.amountBase) <= 0n) {
    throw new RangeError("amountBase must be a positive integer string");
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new RangeError("invalid chain id");
  return `ethereum:${input.token}@${input.chainId}/transfer?address=${input.payTo}&uint256=${input.amountBase}`;
}

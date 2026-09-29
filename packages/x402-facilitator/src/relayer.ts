/**
 * The relayer: one hot key that submits settlement transactions on every
 * enabled network, adapted to the x402 `FacilitatorEvmSigner` interface via
 * viem. Chains resolve from `viem/chains` by the registry chain id; RPC URLs
 * default to the `@settlekit/chains` registry and may be overridden per
 * network. Tempo has no native gas token, so the relayer pays fees in the
 * network's USD TIP-20 token (`feeToken`) and its balance is that token's.
 */
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Chain,
  type PublicClient,
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
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { getEvmChain, type Hex } from "@settlekit/chains";
import type { FacilitatorAsset } from "./assets.js";
import type { GasOracle } from "./gas-guard.js";

const VIEM_CHAINS: Readonly<Record<number, Chain>> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  4663: robinhood,
  999: hyperEvm,
  4217: tempo,
  11155111: sepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
  46630: robinhoodTestnet,
  998: hyperliquidEvmTestnet,
  42431: tempoModerato,
};

const TEMPO_CHAIN_IDS = new Set([4217, 42431]);

export interface RelayerNetworkConfig {
  asset: FacilitatorAsset;
  /** RPC override; defaults to the registry RPC for the asset's chain. */
  rpcUrl?: string;
}

export interface Relayer {
  address: Hex;
  /** x402 facilitator signer per CAIP-2 network. */
  signerFor(caip2: string): FacilitatorEvmSigner | undefined;
  gasOracle: GasOracle;
}

/** The viem chain for `asset`, with Tempo's fee token pinned to the asset. */
export function viemChainFor(asset: FacilitatorAsset, rpcUrl?: string): Chain {
  const known = VIEM_CHAINS[asset.chainId];
  if (!known) throw new Error(`no viem chain definition for chain id ${asset.chainId}`);
  const url = rpcUrl ?? getEvmChain(asset.network, asset.env)?.defaultRpcUrl;
  const withRpc: Chain = url ? { ...known, rpcUrls: { default: { http: [url] } } } : known;
  if (!TEMPO_CHAIN_IDS.has(asset.chainId)) return withRpc;
  return { ...withRpc, feeToken: asset.address } as Chain;
}

/** Build the relayer for `networks` from a 0x-prefixed private key. */
export function createRelayer(privateKey: Hex, networks: readonly RelayerNetworkConfig[]): Relayer {
  const account = privateKeyToAccount(privateKey);
  const signers = new Map<string, FacilitatorEvmSigner>();
  const publicClients = new Map<string, { client: PublicClient; asset: FacilitatorAsset }>();

  for (const { asset, rpcUrl } of networks) {
    const chain = viemChainFor(asset, rpcUrl);
    const transport = http(rpcUrl ?? chain.rpcUrls.default.http[0]);
    const publicClient = createPublicClient({ chain, transport }) as PublicClient;
    const wallet = createWalletClient({ account, chain, transport });
    publicClients.set(asset.caip2, { client: publicClient, asset });
    signers.set(
      asset.caip2,
      toFacilitatorEvmSigner({
        address: account.address,
        readContract: (args) => publicClient.readContract(args as never),
        verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
        writeContract: (args) => wallet.writeContract({ ...args, account, chain } as never),
        sendTransaction: (args) => wallet.sendTransaction({ ...args, account, chain } as never),
        waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
        getCode: (args) => publicClient.getCode(args),
      }),
    );
  }

  const clientFor = (caip2: string) => {
    const entry = publicClients.get(caip2);
    if (!entry) throw new Error(`relayer is not configured for ${caip2}`);
    return entry;
  };

  return {
    address: account.address,
    signerFor: (caip2) => signers.get(caip2),
    gasOracle: {
      gasPrice: (caip2) => clientFor(caip2).client.getGasPrice(),
      async relayerBalance(caip2) {
        const { client, asset } = clientFor(caip2);
        if (!TEMPO_CHAIN_IDS.has(asset.chainId)) return client.getBalance({ address: account.address });
        return client.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        });
      },
    },
  };
}

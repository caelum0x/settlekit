/**
 * Live on-chain balances of the merchant's receiving addresses.
 *
 * SettleKit never holds merchant funds: buyers pay straight into the
 * merchant's own wallets. "Payouts" is therefore a read of what already sits
 * in those wallets, per network, straight from each chain:
 *   - EVM chains: ERC-20 `balanceOf` on the registry stablecoin via JSON-RPC.
 *   - Solana: USDC token accounts owned by the address.
 *   - HyperCore: withdrawable USDC in the Hyperliquid account.
 *   - Zcash: transparent address balance from Blockchair (mainnet only).
 * Each read is independent and time-boxed; a failing RPC yields an error row
 * rather than failing the page.
 */
import type { PaymentNetwork } from "@settlekit/common";
import { getEvmChain, type EvmChainKey } from "@settlekit/chains";
import { apiConfig, balanceEndpoints, networkInfo } from "./network-catalog.js";

export interface NetworkBalance {
  network: PaymentNetwork;
  address: string;
  asset: string;
  /** Decimal string in whole units (e.g. "12.50"), null when unreadable. */
  balance: string | null;
  env: "mainnet" | "testnet";
  error?: string;
  addressUrl: string | null;
}

const TIMEOUT_MS = 8_000;
const BALANCE_OF = "0x70a08231";

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Format integer base units as a decimal string with `decimals` places. */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const shown = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${shown}` : shown;
}

async function evmBalance(key: EvmChainKey, address: string): Promise<string> {
  const cfg = apiConfig();
  const runtime = cfg.evm.enabled[key];
  const spec = runtime?.spec ?? getEvmChain(key, cfg.evm.env);
  if (!spec) throw new Error("chain not in registry");
  const rpcUrl = runtime?.rpcUrl ?? spec.defaultRpcUrl;
  const token = runtime?.tokenAddress ?? spec.token.address;
  const data = `${BALANCE_OF}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const body = (await postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  })) as { result?: string; error?: { message?: string } };
  if (!body.result) throw new Error(body.error?.message ?? "empty eth_call result");
  return formatUnits(BigInt(body.result === "0x" ? "0x0" : body.result), spec.token.decimals);
}

async function solanaBalance(address: string): Promise<string> {
  const { rpcUrl, mint } = balanceEndpoints().solana;
  const body = (await postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [address, { mint }, { encoding: "jsonParsed" }],
  })) as {
    result?: { value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[] };
    error?: { message?: string };
  };
  if (!body.result) throw new Error(body.error?.message ?? "empty RPC result");
  const total = (body.result.value ?? []).reduce((sum, entry) => {
    const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount;
    return sum + (amount && /^\d+$/.test(amount) ? BigInt(amount) : 0n);
  }, 0n);
  return formatUnits(total, 6);
}

async function hyperCoreBalance(address: string): Promise<string> {
  const { apiUrl } = balanceEndpoints().hypercore;
  const body = (await postJson(`${apiUrl}/info`, { type: "clearinghouseState", user: address })) as {
    withdrawable?: string;
  };
  if (typeof body.withdrawable !== "string") throw new Error("no withdrawable balance in response");
  return body.withdrawable;
}

async function zcashBalance(address: string): Promise<string> {
  const { explorerUrl, network, apiKey } = balanceEndpoints().zcash;
  if (network !== "mainnet") throw new Error("Zcash balance reads are mainnet only");
  const url = `${explorerUrl.replace(/\/+$/, "")}/dashboards/address/${encodeURIComponent(address)}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, { address?: { balance?: number | string } }> };
  const balance = body.data?.[address]?.address?.balance;
  if (balance === undefined) throw new Error("address not found in explorer response");
  return formatUnits(BigInt(String(balance)), 8);
}

function addressUrl(network: PaymentNetwork, address: string, env: "mainnet" | "testnet"): string | null {
  switch (network) {
    case "solana":
      return `https://solscan.io/account/${address}${env === "testnet" ? "?cluster=devnet" : ""}`;
    case "hypercore":
      return `https://app.hyperliquid${env === "testnet" ? "-testnet" : ""}.xyz/explorer/address/${address}`;
    case "zcash":
      return env === "mainnet" ? `https://blockchair.com/zcash/address/${address}` : null;
    default: {
      const spec = getEvmChain(network as EvmChainKey, env);
      const tx = spec?.explorerTx("0x");
      return tx ? tx.replace(/\/tx\/0x$/, `/address/${address}`) : null;
    }
  }
}

async function readOne(network: PaymentNetwork, address: string): Promise<string> {
  switch (network) {
    case "solana":
      return solanaBalance(address);
    case "hypercore":
      return hyperCoreBalance(address);
    case "zcash":
      return zcashBalance(address);
    default:
      return evmBalance(network as EvmChainKey, address);
  }
}

/** Read every accepted network's balance in parallel. */
export async function readBalances(payToByNetwork: Partial<Record<PaymentNetwork, string>>): Promise<NetworkBalance[]> {
  const entries = Object.entries(payToByNetwork) as [PaymentNetwork, string][];
  return Promise.all(
    entries.map(async ([network, address]): Promise<NetworkBalance> => {
      const info = networkInfo(network);
      const env = info?.env ?? "mainnet";
      const base = { network, address, asset: info?.asset ?? "USDC", env, addressUrl: addressUrl(network, address, env) };
      try {
        return { ...base, balance: await readOne(network, address) };
      } catch (err) {
        return { ...base, balance: null, error: err instanceof Error ? err.message : "balance read failed" };
      }
    }),
  );
}

/**
 * Browser-side Solana wallet access over the Wallet Standard
 * (`@wallet-standard/app` getWallets). The server builds the transaction; the
 * wallet only signs and sends it via `solana:signAndSendTransaction`, so the
 * buyer's wallet can never change recipient, mint, amount or reference.
 */
import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";

export type StandardWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
export type StandardWalletAccount = StandardWallet["accounts"][number];

export type SolanaChain = "solana:mainnet" | "solana:devnet";

const CONNECT = "standard:connect";
const SIGN_AND_SEND = "solana:signAndSendTransaction";

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }>;
}

interface SignAndSendFeature {
  signAndSendTransaction(
    ...inputs: ReadonlyArray<{
      account: StandardWalletAccount;
      transaction: Uint8Array;
      chain: SolanaChain;
    }>
  ): Promise<ReadonlyArray<{ signature: Uint8Array }>>;
}

/** The Wallet Standard chain id for a checkout cluster. */
export function solanaChainFor(cluster: "mainnet" | "devnet"): SolanaChain {
  return cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
}

function feature<T>(wallet: StandardWallet, name: string): T | undefined {
  return (wallet.features as Readonly<Record<string, unknown>>)[name] as T | undefined;
}

/** Whether a wallet can connect and sign+send a Solana transaction. */
export function canPayOnSolana(wallet: StandardWallet): boolean {
  return (
    feature<ConnectFeature>(wallet, CONNECT) !== undefined &&
    feature<SignAndSendFeature>(wallet, SIGN_AND_SEND) !== undefined &&
    wallet.chains.some((chain) => chain.startsWith("solana:"))
  );
}

/** Installed Solana wallets, kept current as extensions register/unregister. */
export function useSolanaWallets(): readonly StandardWallet[] {
  const [wallets, setWallets] = useState<readonly StandardWallet[]>([]);
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(canPayOnSolana));
    refresh();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  return wallets;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Connect `wallet`, fetch the server-built transaction for the connected
 * account and have the wallet sign + send it. Resolves once the wallet has
 * submitted the transaction; confirmation is observed by status polling.
 */
export async function payWithStandardWallet(
  wallet: StandardWallet,
  chain: SolanaChain,
  buildTransaction: (account: string) => Promise<string>,
): Promise<void> {
  const connect = feature<ConnectFeature>(wallet, CONNECT);
  const signAndSend = feature<SignAndSendFeature>(wallet, SIGN_AND_SEND);
  if (!connect || !signAndSend) throw new Error(`${wallet.name} cannot send Solana transactions.`);

  const { accounts } = await connect.connect();
  const account = accounts.find((a) => a.chains.includes(chain)) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account.`);

  const transaction = base64ToBytes(await buildTransaction(account.address));
  await signAndSend.signAndSendTransaction({ account, transaction, chain });
}

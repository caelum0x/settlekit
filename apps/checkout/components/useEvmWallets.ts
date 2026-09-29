"use client";

import { useEffect, useState } from "react";

import { legacyInjectedWallet, watchEip6963Wallets, type Eip6963ProviderDetail } from "@/lib/evm-wallet";

/** Wait this long for EIP-6963 announcements before offering window.ethereum. */
const LEGACY_FALLBACK_MS = 500;

/**
 * Installed EVM wallets: EIP-6963 announcements (every modern wallet), with
 * the legacy injected `window.ethereum` offered only when nothing announces.
 */
export function useEvmWallets(): Eip6963ProviderDetail[] {
  const [wallets, setWallets] = useState<Eip6963ProviderDetail[]>([]);

  useEffect(() => {
    let announced = false;
    const stop = watchEip6963Wallets(window, (list) => {
      announced = true;
      setWallets(list);
    });
    const timer = window.setTimeout(() => {
      if (announced) return;
      const legacy = legacyInjectedWallet((window as unknown as { ethereum?: unknown }).ethereum);
      if (legacy) setWallets([legacy]);
    }, LEGACY_FALLBACK_MS);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  return wallets;
}

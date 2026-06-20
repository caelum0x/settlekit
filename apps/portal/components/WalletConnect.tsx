"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Hex } from "viem";
import { customerIdFromAccount, requestWalletNonce, walletLogin } from "@/lib/auth";

/** Minimal EIP-1193 provider surface we use (injected browser wallets). */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Notice {
  ok: boolean;
  text: string;
}

function getProvider(): Eip1193Provider | undefined {
  return typeof window !== "undefined"
    ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum
    : undefined;
}

/**
 * "Connect Wallet" sign-in (Sign-In-With-Ethereum) for the customer portal.
 * Requests a nonce, builds an EIP-4361 message, signs it via `personal_sign`,
 * and exchanges the signature for a session — then redirects to the customer
 * page.
 */
export function WalletConnect() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function onConnect() {
    setPending(true);
    setNotice(null);
    try {
      const provider = getProvider();
      if (!provider) {
        setNotice({
          ok: false,
          text: "No Ethereum wallet found. Install MetaMask or a compatible wallet.",
        });
        return;
      }

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const raw = accounts[0];
      if (!raw) {
        setNotice({ ok: false, text: "No wallet account was authorized." });
        return;
      }
      const address = getAddress(raw);

      const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16) || 1;

      const nonceRes = await requestWalletNonce(address);
      if (!nonceRes.ok) {
        setNotice({ ok: false, text: nonceRes.error });
        return;
      }

      const message = createSiweMessage({
        address,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        nonce: nonceRes.data.nonce,
        version: "1",
        statement: "Sign in to SettleKit.",
      });

      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as Hex;

      const result = await walletLogin({ message, signature });
      if (!result.ok) {
        setNotice({ ok: false, text: result.error });
        return;
      }

      router.replace(`/c/${encodeURIComponent(customerIdFromAccount(result.data))}`);
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Wallet sign-in was cancelled.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet-connect">
      <button type="button" className="btn" onClick={onConnect} disabled={pending}>
        {pending ? "Connecting…" : "Connect Wallet"}
      </button>
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </div>
  );
}

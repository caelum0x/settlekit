"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Hex } from "viem";
import { requestWalletNonce, walletLogin, type AccountType } from "@/lib/auth";

/** Minimal EIP-1193 provider surface we use (injected browser wallets). */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface WalletConnectProps {
  /** Account type to create on first sign-in. The dashboard onboards merchants. */
  type?: AccountType;
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

/** Persist the session token in the httpOnly cookie via the session route. */
async function persistSession(sessionToken: string): Promise<void> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    throw new Error("Could not establish session. Please try again.");
  }
}

/**
 * "Connect Wallet" sign-in (Sign-In-With-Ethereum). Requests a nonce, builds an
 * EIP-4361 message, has the wallet sign it via `personal_sign`, and exchanges
 * the signature for a session — no passwords, no email.
 */
export function WalletConnect({ type = "merchant" }: WalletConnectProps) {
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
      if (nonceRes.error || !nonceRes.data) {
        setNotice({ ok: false, text: nonceRes.error ?? "Could not start sign-in." });
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

      const result = await walletLogin({ message, signature, type });
      if (result.error || !result.data) {
        setNotice({ ok: false, text: result.error ?? "Wallet sign-in failed." });
        return;
      }

      await persistSession(result.data.sessionToken);
      router.push("/");
      router.refresh();
    } catch (err) {
      // EIP-1193 user-rejection or any other failure.
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

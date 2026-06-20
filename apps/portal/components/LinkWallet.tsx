"use client";

import { useEffect, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Hex } from "viem";
import { getSession, requestWalletNonce } from "@/lib/auth";

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
 * "Link wallet" for the signed-in customer. Signs a SIWE message and posts it to
 * the local /api/wallet/link route, which forwards the session cookie as bearer.
 * Lets a customer attach a wallet to sign in with later.
 */
export function LinkWallet() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [linked, setLinked] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getSession().then((res) => {
      if (!active) return;
      if (res.ok && typeof res.data.walletAddress === "string") {
        setLinked(res.data.walletAddress);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function onLink() {
    setPending(true);
    setNotice(null);
    try {
      const provider = getProvider();
      if (!provider) {
        setNotice({ ok: false, text: "No Ethereum wallet found. Install MetaMask or similar." });
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
        statement: "Link this wallet to your SettleKit account.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60 * 1000),
      });
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as Hex;

      const res = await fetch("/api/wallet/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { account?: { walletAddress?: string } }; error?: { message?: string } | string }
        | null;
      if (!res.ok || !body?.data) {
        const msg =
          body && typeof body.error === "object" && body.error?.message
            ? body.error.message
            : "Could not link wallet.";
        setNotice({ ok: false, text: msg });
        return;
      }
      setLinked(body.data.account?.walletAddress ?? address);
      setNotice({ ok: true, text: "Wallet linked. You can now sign in with it." });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Wallet linking was cancelled." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet-link">
      {linked ? (
        <p className="muted">
          Linked wallet: <span className="mono">{linked}</span>
        </p>
      ) : (
        <p className="muted">No wallet linked yet.</p>
      )}
      <button type="button" className="btn" onClick={onLink} disabled={pending}>
        {pending ? "Linking…" : linked ? "Link a different wallet" : "Link wallet"}
      </button>
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </div>
  );
}

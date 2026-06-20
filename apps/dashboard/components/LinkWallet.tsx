"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Hex } from "viem";
import { requestWalletNonce } from "@/lib/auth";

/** Minimal EIP-1193 provider surface we use (injected browser wallets). */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface LinkWalletProps {
  /** The wallet already linked to this account, if any. */
  linkedAddress?: string;
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
 * "Link wallet" for an already-signed-in account. Signs a SIWE message and
 * posts it to the local /api/wallet/link route, which forwards the session
 * cookie as the bearer. Lets an email/password user attach a wallet they can
 * later sign in with.
 */
export function LinkWallet({ linkedAddress }: LinkWalletProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [linked, setLinked] = useState<string | undefined>(linkedAddress);

  async function onLink() {
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
        setNotice({ ok: false, text: nonceRes.error ?? "Could not start linking." });
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
        | { data?: { account?: { walletAddress?: string } }; error?: string }
        | null;
      if (!res.ok || !body?.data) {
        setNotice({ ok: false, text: body?.error ?? "Could not link wallet." });
        return;
      }

      setLinked(body.data.account?.walletAddress ?? address);
      setNotice({ ok: true, text: "Wallet linked. You can now sign in with it." });
      router.refresh();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Wallet linking was cancelled.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet-link">
      {linked ? (
        <p className="field-hint">
          Linked wallet: <span className="mono">{linked}</span>
        </p>
      ) : null}
      <button type="button" className="btn" onClick={onLink} disabled={pending}>
        {pending ? "Linking…" : linked ? "Link a different wallet" : "Link wallet"}
      </button>
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </div>
  );
}

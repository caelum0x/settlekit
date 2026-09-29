"use client";

import { useCallback, useState } from "react";
import { getAddress } from "viem";

import { ApiClientError, cancelManagedSubscription } from "@/lib/api";
import type { SubscriptionView } from "@/lib/billing-api";
import { isUserRejection, toHexChainId, walletChainId, type Eip6963ProviderDetail, type Hex } from "@/lib/evm-wallet";
import type { CancelManagedResult } from "@/lib/manage-subscription";
import { solanaChainFor, useSolanaWallets, type StandardWallet } from "@/lib/solana-wallets";
import { connectSolanaAccount, sendCallsAndWait, signAndSendBase64, type WalletCall } from "@/lib/subscription-wallet";
import { useEvmWallets } from "./useEvmWallets";

interface ManageSubscriptionProps {
  token: string;
  initial: SubscriptionView;
  solanaCluster: "mainnet" | "devnet";
}

const STATUS_LABEL: Record<SubscriptionView["status"], string> = {
  pending_grant: "Waiting for authorization",
  active: "Active",
  past_due: "Payment failed, retrying",
  suspended: "Suspended (payment failed)",
  canceled: "Canceled",
};

const METHOD_LABEL: Record<SubscriptionView["method"], string> = {
  spend_permission: "Smart wallet spend permission",
  permit2: "Wallet allowance (Permit2)",
  spl_delegate: "Solana token delegate",
  renewal_invoice: "Renewal invoice by email",
};

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function messageOf(error: unknown, fallback: string): string {
  if (isUserRejection(error)) return "The request was rejected in your wallet.";
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return (error as Error & { shortMessage?: string }).shortMessage ?? error.message;
  return fallback;
}

/** Status, next charge, charges and cancel (+ on-chain revoke) for one subscription. */
export function ManageSubscription({ token, initial, solanaCluster }: ManageSubscriptionProps) {
  const [view, setView] = useState(initial);
  const [revoke, setRevoke] = useState<CancelManagedResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);
  const evmWallets = useEvmWallets();
  const solanaWallets = useSolanaWallets();
  const per = view.interval === "yearly" ? "year" : "month";

  const cancel = useCallback(async () => {
    if (!window.confirm(`Cancel this subscription? You keep access until ${date(view.currentPeriodEnd)} and will not be charged again.`)) return;
    setBusy("Canceling...");
    setError(null);
    try {
      const result = await cancelManagedSubscription(token);
      setView(result.view);
      setRevoke(result);
    } catch (err) {
      setError(messageOf(err, "Could not cancel the subscription."));
    } finally {
      setBusy(null);
    }
  }, [token, view.currentPeriodEnd]);

  const revokeEvm = useCallback(
    async (wallet: Eip6963ProviderDetail) => {
      const action = revoke?.revoke;
      if (!action || action.kind !== "send_calls") return;
      setError(null);
      try {
        setBusy(`Connecting to ${wallet.info.name}...`);
        const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
        const first = Array.isArray(accounts) ? accounts[0] : undefined;
        if (typeof first !== "string") throw new Error("The wallet did not share an account.");
        const account = getAddress(first) as Hex;
        if (account.toLowerCase() !== view.payer.toLowerCase()) throw new Error(`Connect the subscribing wallet ${short(view.payer)}.`);
        const calls = action.payerCalls as WalletCall[];
        const chainId = calls[0]?.chainId;
        if (chainId !== undefined && (await walletChainId(wallet.provider)) !== chainId) {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexChainId(chainId) }] });
        }
        setBusy("Confirm the revoke in your wallet...");
        const hashes = await sendCallsAndWait(wallet.provider, account, calls);
        setRevoked(hashes.at(-1) ?? "done");
      } catch (err) {
        setError(messageOf(err, "The wallet did not revoke the allowance."));
      } finally {
        setBusy(null);
      }
    },
    [revoke, view.payer],
  );

  const revokeSolana = useCallback(
    async (wallet: StandardWallet) => {
      const action = revoke?.revoke;
      if (!action || action.kind !== "send_transaction") return;
      setError(null);
      try {
        const chain = solanaChainFor(solanaCluster);
        setBusy(`Connecting to ${wallet.name}...`);
        const account = await connectSolanaAccount(wallet, chain);
        if (account.address !== view.payer) throw new Error(`Connect the subscribing wallet ${short(view.payer)}.`);
        setBusy("Approve the revoke in your wallet...");
        setRevoked(await signAndSendBase64(wallet, account, chain, action.transaction));
      } catch (err) {
        setError(messageOf(err, "The wallet did not revoke the delegation."));
      } finally {
        setBusy(null);
      }
    },
    [revoke, view.payer, solanaCluster],
  );

  const canCancel = view.status !== "canceled" && !view.cancelAtPeriodEnd;
  const revokeAction = revoke?.revoke ?? null;

  return (
    <div>
      <div className="card">
        <p className="merchant">Subscription</p>
        <h2>{view.productName}</h2>
        <dl className="sub-grid">
          <dt>Status</dt>
          <dd>
            <span className={`badge badge-status-${view.status}`}>{STATUS_LABEL[view.status]}</span>
            {view.cancelAtPeriodEnd && view.status !== "canceled" ? <span className="muted"> · ends {date(view.currentPeriodEnd)}</span> : null}
          </dd>
          <dt>Price</dt>
          <dd>
            ${view.amountPerPeriod} / {per} · {view.networkName}
          </dd>
          <dt>Paid through</dt>
          <dd>{date(view.currentPeriodEnd)}</dd>
          <dt>Next charge</dt>
          <dd>{view.nextChargeAt ? `${date(view.nextChargeAt)} ($${view.amountPerPeriod})` : "None scheduled"}</dd>
          <dt>Collected by</dt>
          <dd>{METHOD_LABEL[view.method]}</dd>
          {view.method !== "renewal_invoice" ? (
            <>
              <dt>You authorized</dt>
              <dd>
                Up to ${view.cap} in total ({view.periodsCovered} {per}s), at most ${view.amountPerPeriod} per {per}
                {view.grantExpiresAt && view.method !== "spl_delegate" ? `, until ${date(view.grantExpiresAt)}` : ""}.
              </dd>
              <dt>Paying wallet</dt>
              <dd className="mono">{view.payer}</dd>
            </>
          ) : null}
        </dl>
        {view.dunning !== "none" ? (
          <div className="alert alert-error" role="alert">
            The last charge failed{view.lastChargeError ? ` (${view.lastChargeError})` : ""}.{" "}
            {view.dunning === "retrying"
              ? "We retry automatically; top up the wallet to keep access."
              : "Access is paused until a charge succeeds."}
          </div>
        ) : null}
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        {busy ? (
          <div className="solana-waiting muted" role="status">
            <span className="pulse" aria-hidden="true" />
            {busy}
          </div>
        ) : null}
        {canCancel ? (
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void cancel()}>
            Cancel subscription
          </button>
        ) : null}
      </div>

      {revoke ? (
        <div className="card">
          <h2>Canceled</h2>
          <p className="muted">
            No further charges will be made. {view.currentPeriodEnd ? `You keep access until ${date(view.currentPeriodEnd)}.` : ""}
          </p>
          {revoke.operatorRevokeTx ? (
            <p className="muted">
              The spend permission was revoked on-chain for you (<span className="mono">{short(revoke.operatorRevokeTx)}</span>).
            </p>
          ) : null}
          {revokeAction && !revoked ? (
            <>
              <p>
                Optional: also revoke the {revokeAction.kind === "send_calls" ? "allowance" : "token delegation"} from your wallet so it
                can never be used again.
              </p>
              <div className="solana-wallets">
                {revokeAction.kind === "send_calls"
                  ? evmWallets.map((wallet) => (
                      <button key={wallet.info.uuid} type="button" className="btn wallet-btn" disabled={busy !== null} onClick={() => void revokeEvm(wallet)}>
                        <span>{`Revoke with ${wallet.info.name}`}</span>
                      </button>
                    ))
                  : solanaWallets.map((wallet) => (
                      <button key={wallet.name} type="button" className="btn wallet-btn" disabled={busy !== null} onClick={() => void revokeSolana(wallet)}>
                        <span>{`Revoke with ${wallet.name}`}</span>
                      </button>
                    ))}
              </div>
            </>
          ) : null}
          {revoked ? <div className="alert alert-success">Revoked in your wallet.</div> : null}
        </div>
      ) : null}

      <div className="card">
        <h2>Charges</h2>
        {view.charges.length === 0 ? (
          <p className="muted">No charges yet.</p>
        ) : (
          <ul className="plain-list">
            {view.charges.map((charge) => (
              <li key={charge.id} className="line">
                <div>
                  <div className="line-name">
                    Period {charge.periodIndex + 1} · {charge.status.replace("_", " ")}
                  </div>
                  <div className="line-desc">
                    {date(charge.updatedAt)}
                    {charge.failureReason ? ` · ${charge.failureReason}` : ""}
                    {charge.invoiceRef && charge.status === "awaiting_payment" ? (
                      <>
                        {" · "}
                        <a className="link" href={`/c/${charge.invoiceRef}`}>
                          Pay this period
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="line-amount">
                  ${charge.amount}
                  {charge.explorerUrl ? (
                    <>
                      {" "}
                      <a className="link mono" href={charge.explorerUrl} target="_blank" rel="noreferrer">
                        {short(charge.txHash ?? "")}
                      </a>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

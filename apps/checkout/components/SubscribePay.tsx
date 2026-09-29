"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";

import { ApiClientError, completeSubscription, getEvmParams, getSubscriptionOffer, startSubscription } from "@/lib/api";
import { isUserRejection, switchOrAddChain, walletChainId, type Eip6963ProviderDetail, type Hex } from "@/lib/evm-wallet";
import { validateFields } from "@/lib/fields";
import { solanaChainFor, useSolanaWallets, type StandardWallet } from "@/lib/solana-wallets";
import type { CompleteSubscriptionResult, MethodOption, StartSubscriptionResult, SubscriptionOffer } from "@/lib/subscription-checkout";
import {
  connectSolanaAccount,
  sendCallsAndWait,
  signAndSendBase64,
  signTypedDataV4,
  type TypedDataJson,
  type WalletCall,
} from "@/lib/subscription-wallet";
import type { CollectedFieldSpec } from "@/lib/types";
import { BuyerFields, useBuyerFields } from "./BuyerFields";
import { useEvmWallets } from "./useEvmWallets";

interface SubscribePayProps {
  sessionId: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Stage =
  | { kind: "ready" }
  | { kind: "working"; step: string }
  | { kind: "done"; result: CompleteSubscriptionResult };

const GRANT_RETRY_MS = 3_000;
const GRANT_RETRIES = 20;
const NOT_LANDED = /not landed|not delegated|not found/i;
const PER: Record<string, string> = { monthly: "month", yearly: "year" };

function messageOf(error: unknown, fallback: string): string {
  if (isUserRejection(error)) return "The request was rejected in your wallet.";
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return (error as Error & { shortMessage?: string }).shortMessage ?? error.message;
  return fallback;
}

function formatDate(iso: string | null): string {
  if (!iso) return "until you revoke it";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

async function requestAccount(wallet: Eip6963ProviderDetail): Promise<Hex> {
  const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new Error("The wallet did not share an account.");
  return getAddress(first);
}

/** What the buyer authorizes with `method`, in plain words. */
function Authorization({ offer, method }: { offer: SubscriptionOffer; method: MethodOption }) {
  const per = PER[offer.interval] ?? "period";
  if (method.method === "renewal_invoice") {
    return (
      <ul className="plain-list sub-terms">
        <li>
          You pay <strong>${offer.amount}</strong> now, then we email a payment link every {per}.
        </li>
        <li>Nothing is pulled from your wallet. If you do not pay a renewal, access pauses.</li>
        <li>Cancel any time from the manage link we show after you subscribe.</li>
      </ul>
    );
  }
  return (
    <ul className="plain-list sub-terms">
      <li>
        <strong>${offer.amount}</strong> is charged now and once every {per} after that, at most one charge per {per}.
      </li>
      <li>
        Total cap: <strong>${offer.cap}</strong> ({offer.periods} {per}s x ${offer.amount}). Your wallet enforces it; nothing
        above it can ever be taken.
      </li>
      <li>
        {method.method === "spl_delegate" ? (
          <>The delegation lasts until you revoke it or the cap is used up.</>
        ) : (
          <>
            The authorization expires on <strong>{formatDate(offer.grantEndsAt)}</strong>.
          </>
        )}
      </li>
      <li>Funds go straight to the seller. Cancel any time from your manage link; your wallet can also revoke on-chain.</li>
    </ul>
  );
}

/**
 * Subscribe on the session's network: pick an authorization method, connect
 * a wallet (EIP-6963 for EVM, Wallet Standard for Solana), sign the grant the
 * server built, and the server charges the first period and delivers access.
 * Renewal invoices need no wallet: the first period is paid on a checkout
 * page, later ones by emailed links.
 */
export function SubscribePay({ sessionId, requiredFields, initialValues }: SubscribePayProps) {
  const evmWallets = useEvmWallets();
  const solanaWallets = useSolanaWallets();
  const { fields, setField } = useBuyerFields(requiredFields, initialValues);
  const [offer, setOffer] = useState<SubscriptionOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MethodOption | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<StartSubscriptionResult["terms"] | null>(null);

  useEffect(() => {
    let active = true;
    getSubscriptionOffer(sessionId)
      .then((loaded) => {
        if (!active) return;
        setOffer(loaded);
        setSelected(loaded.methods[0] ?? null);
      })
      .catch((err: unknown) => active && setLoadError(messageOf(err, "Subscriptions are unavailable right now.")));
    return () => {
      active = false;
    };
  }, [sessionId]);

  const checkFields = useCallback((): boolean => {
    const problems = validateFields(requiredFields, fields);
    if (problems.length > 0) {
      setError(problems.join(" "));
      return false;
    }
    setError(null);
    return true;
  }, [requiredFields, fields]);

  const grantWithRetry = useCallback(
    async (payload: { subscriptionId: string; signature?: string; approveSignature?: string }) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await completeSubscription(sessionId, payload);
        } catch (err) {
          const retryable = err instanceof ApiClientError && NOT_LANDED.test(err.message) && attempt < GRANT_RETRIES;
          if (!retryable) throw err;
          setStage({ kind: "working", step: "Waiting for your approval to land on-chain..." });
          await new Promise((resolve) => setTimeout(resolve, GRANT_RETRY_MS));
        }
      }
    },
    [sessionId],
  );

  const finish = useCallback((result: CompleteSubscriptionResult) => {
    if (result.invoiceUrl && result.outcome !== "succeeded") {
      window.location.assign(result.invoiceUrl);
      return;
    }
    setStage({ kind: "done", result });
  }, []);

  const subscribeEvm = useCallback(
    async (wallet: Eip6963ProviderDetail) => {
      if (!selected || !checkFields()) return;
      try {
        setStage({ kind: "working", step: `Connecting to ${wallet.info.name}...` });
        const account = await requestAccount(wallet);
        const params = await getEvmParams(sessionId);
        setStage({ kind: "working", step: `Switching to ${params.chainName}...` });
        await switchOrAddChain(wallet.provider, params.addChain);
        if ((await walletChainId(wallet.provider)) !== params.chainId) {
          throw new Error(`Switch your wallet to ${params.chainName} and try again.`);
        }
        setStage({ kind: "working", step: "Preparing your subscription..." });
        const started = await startSubscription(sessionId, { method: selected.method, payer: account, fields });
        setTerms(started.terms);
        if (started.action.kind !== "sign_typed_data") throw new Error("Unexpected wallet action for this method.");
        const calls = started.action.payerCalls as WalletCall[];
        if (calls.length > 0) {
          await sendCallsAndWait(wallet.provider, account, calls, (call) =>
            setStage({ kind: "working", step: `Confirm in your wallet: ${call.description}...` }),
          );
        }
        setStage({ kind: "working", step: `Sign the ${selected.label.toLowerCase()} in your wallet...` });
        const signature = await signTypedDataV4(wallet.provider, account, started.action.typedData as TypedDataJson);
        setStage({ kind: "working", step: "Activating and charging the first period..." });
        finish(await grantWithRetry({ subscriptionId: started.subscriptionId, signature }));
      } catch (err) {
        setError(messageOf(err, "The subscription was not authorized."));
        setStage({ kind: "ready" });
      }
    },
    [selected, checkFields, sessionId, fields, finish, grantWithRetry],
  );

  const subscribeSolana = useCallback(
    async (wallet: StandardWallet) => {
      if (!selected || !offer || !checkFields()) return;
      try {
        const chain = solanaChainFor(offer.solanaCluster);
        setStage({ kind: "working", step: `Connecting to ${wallet.name}...` });
        const account = await connectSolanaAccount(wallet, chain);
        setStage({ kind: "working", step: "Preparing your subscription..." });
        const started = await startSubscription(sessionId, { method: selected.method, payer: account.address, fields });
        setTerms(started.terms);
        if (started.action.kind !== "send_transaction") throw new Error("Unexpected wallet action for this method.");
        setStage({ kind: "working", step: "Approve the capped USDC delegation in your wallet..." });
        const approveSignature = await signAndSendBase64(wallet, account, chain, started.action.transaction);
        setStage({ kind: "working", step: "Activating and charging the first period..." });
        finish(await grantWithRetry({ subscriptionId: started.subscriptionId, approveSignature }));
      } catch (err) {
        setError(messageOf(err, "The subscription was not authorized."));
        setStage({ kind: "ready" });
      }
    },
    [selected, offer, checkFields, sessionId, fields, finish, grantWithRetry],
  );

  const subscribeInvoice = useCallback(async () => {
    if (!selected || !checkFields()) return;
    try {
      setStage({ kind: "working", step: "Setting up renewal invoices..." });
      const started = await startSubscription(sessionId, { method: selected.method, fields });
      setTerms(started.terms);
      finish(await completeSubscription(sessionId, { subscriptionId: started.subscriptionId }));
    } catch (err) {
      setError(messageOf(err, "Could not set up the subscription."));
      setStage({ kind: "ready" });
    }
  }, [selected, checkFields, sessionId, fields, finish]);

  const busy = stage.kind === "working";
  const per = offer ? (PER[offer.interval] ?? "period") : "period";
  const walletButtons = useMemo(() => {
    if (!selected) return null;
    if (selected.wallet === null) {
      return (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void subscribeInvoice()}>
          Subscribe and pay the first {per}
        </button>
      );
    }
    const list =
      selected.wallet === "evm"
        ? evmWallets.map((wallet) => (
            <button key={wallet.info.uuid} type="button" className="btn wallet-btn" disabled={busy} onClick={() => void subscribeEvm(wallet)}>
              {wallet.info.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.info.icon} alt="" width={20} height={20} />
              ) : null}
              <span>{`Subscribe with ${wallet.info.name}`}</span>
            </button>
          ))
        : solanaWallets.map((wallet) => (
            <button key={wallet.name} type="button" className="btn wallet-btn" disabled={busy} onClick={() => void subscribeSolana(wallet)}>
              {wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.icon} alt="" width={20} height={20} />
              ) : null}
              <span>{`Subscribe with ${wallet.name}`}</span>
            </button>
          ));
    return list.length > 0 ? (
      list
    ) : (
      <p className="muted solana-note">
        No {selected.wallet === "evm" ? "EVM" : "Solana"} browser wallet detected. Install one, or choose another method.
      </p>
    );
  }, [selected, busy, per, evmWallets, solanaWallets, subscribeEvm, subscribeSolana, subscribeInvoice]);

  if (loadError) return <div className="alert alert-info">{loadError}</div>;
  if (!offer) return <p className="muted">Loading subscription options...</p>;

  if (stage.kind === "done") {
    const { result } = stage;
    const ok = result.outcome === "succeeded";
    return (
      <div className={`alert ${ok ? "alert-success" : "alert-info"}`} role="status">
        <strong>{ok ? "You are subscribed." : "Subscription authorized."}</strong>{" "}
        {ok
          ? `The first ${per} is paid and your access is being delivered to ${fields.email ?? "you"}.`
          : result.failure
            ? `The first charge did not go through yet (${result.failure}). We retry automatically; make sure the wallet holds enough USDC.`
            : "The first charge is being processed; this page will show it once it settles."}
        <div className="solana-paid-actions">
          <a className="btn btn-primary" href={result.manageUrl}>
            Manage subscription
          </a>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Bookmark the manage page: it shows the next charge and lets you cancel any time.
        </p>
      </div>
    );
  }

  if (offer.existing) {
    return (
      <div className="alert alert-success" role="status">
        You already subscribed from this checkout ({offer.existing.status.replace("_", " ")}).{" "}
        <a className="link" href={offer.existing.manageUrl}>
          Manage subscription
        </a>
      </div>
    );
  }

  if (!offer.available) return <div className="alert alert-info">{offer.reason}</div>;

  return (
    <div className="subscribe-pay">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="sub-headline">
        <strong>${offer.amount}</strong> / {per} on {offer.networkName}. Cancel any time.
      </p>
      <fieldset className="sub-methods" disabled={busy}>
        <legend className="label">How should renewals be collected?</legend>
        {offer.methods.map((method) => (
          <label key={method.method} className={`sub-method${selected?.method === method.method ? " selected" : ""}`}>
            <input
              type="radio"
              name="sub-method"
              value={method.method}
              checked={selected?.method === method.method}
              onChange={() => {
                setSelected(method);
                setTerms(null);
              }}
            />
            <span>
              <strong>{method.label}</strong>
              <span className="help">{method.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {selected ? (
        <div className="payto sub-authorize">
          <div className="label">What you are authorizing</div>
          <Authorization offer={offer} method={selected} />
          {terms && terms.spender ? (
            <p className="muted mono sub-spender">
              Spender {terms.spender} · cap ${terms.cap}
              {terms.expiresAt ? ` · expires ${formatDate(terms.expiresAt)}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      <BuyerFields idPrefix="sub" requiredFields={requiredFields} fields={fields} onChange={setField} disabled={busy} />
      <div className="solana-wallets">
        {walletButtons}
        {stage.kind === "working" ? (
          <div className="solana-waiting muted" role="status">
            <span className="pulse" aria-hidden="true" />
            {stage.step}
          </div>
        ) : null}
      </div>
    </div>
  );
}

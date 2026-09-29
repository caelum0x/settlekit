"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { getAddress } from "viem";

import type { AnyTokenOptionsResponse, OriginChainOption, RouteQuoteView, RouteStatusView } from "@/lib/any-token";
import {
  FINAL_ROUTE_STATES,
  formatBps,
  formatUsd,
  routeProgressLabel,
  toRpcTransaction,
  waitForReceipt,
} from "@/lib/any-token-client";
import { ApiClientError, getAnyTokenOptions, getRouteStatus, requestRouteQuote } from "@/lib/api";
import { isUnknownChainError, isUserRejection, toHexChainId, walletChainId, type Eip6963ProviderDetail } from "@/lib/evm-wallet";
import { validateFields } from "@/lib/fields";
import { remainingMs, formatCountdown, shortHash } from "@/lib/pay-display";
import type { CollectedFieldSpec } from "@/lib/types";
import { BuyerFields, useBuyerFields } from "./BuyerFields";
import { CopyButton } from "./CopyButton";
import { useEvmWallets } from "./useEvmWallets";

interface AnyTokenPayProps {
  sessionId: string;
  networkName: string;
  /** e.g. "25 USDC". */
  amountLabel: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Stage =
  | { kind: "choose" }
  | { kind: "working"; step: string }
  | { kind: "quoted"; quote: RouteQuoteView; account: string | null; walletId: string | null }
  | { kind: "tracking"; view: RouteStatusView | null; originTxHash?: string };

const POLL_INTERVAL_MS = 4_000;

function messageOf(error: unknown, fallback: string): string {
  if (isUserRejection(error)) return "The request was rejected in your wallet.";
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return (error as Error & { shortMessage?: string }).shortMessage ?? error.message;
  return fallback;
}

async function connect(wallet: Eip6963ProviderDetail): Promise<string> {
  const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new Error("The wallet did not share an account.");
  return getAddress(first);
}

async function switchChain(wallet: Eip6963ProviderDetail, chainId: number, chainName: string): Promise<void> {
  if ((await walletChainId(wallet.provider)) === chainId) return;
  try {
    await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexChainId(chainId) }] });
  } catch (error) {
    if (isUnknownChainError(error)) throw new Error(`Add ${chainName} to your wallet first, or use the deposit address option.`);
    throw error;
  }
  if ((await walletChainId(wallet.provider)) !== chainId) throw new Error(`Switch your wallet to ${chainName} and try again.`);
}

/** Send every provider step in order; returns the last (deposit) tx hash. */
async function executeSteps(wallet: Eip6963ProviderDetail, quote: RouteQuoteView, account: string, onStep: (text: string) => void): Promise<string> {
  let last: string | undefined;
  for (const [index, tx] of quote.transactions.entries()) {
    const label = quote.transactions.length > 1 ? ` (${index + 1}/${quote.transactions.length})` : "";
    onStep(`Confirm the transaction in your wallet${label}…`);
    const hash = await wallet.provider.request({ method: "eth_sendTransaction", params: [toRpcTransaction(tx, account)] });
    if (typeof hash !== "string") throw new Error("The wallet did not return a transaction hash.");
    onStep(`Waiting for the origin chain to confirm${label}…`);
    await waitForReceipt(wallet.provider, hash);
    last = hash;
  }
  if (last === undefined) throw new Error("The route has no transactions to send.");
  return last;
}

/**
 * Pay with any token on any chain. The buyer picks an origin chain and token,
 * gets an EXACT_OUTPUT quote (Relay, LI.FI fallback) with fees shown, then
 * either lets an EIP-6963 wallet run the route's transactions or sends funds
 * to a one-time deposit address (QR). The page polls the route; the order is
 * paid only when the delivery to the merchant verifies on-chain. Failed
 * routes refund to the buyer's origin wallet.
 */
export function AnyTokenPay({ sessionId, networkName, amountLabel, requiredFields, initialValues }: AnyTokenPayProps) {
  const wallets = useEvmWallets();
  const { fields, setField } = useBuyerFields(requiredFields, initialValues);
  const [options, setOptions] = useState<AnyTokenOptionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [token, setToken] = useState<string>("");
  const [useDeposit, setUseDeposit] = useState(false);
  const [refundAddress, setRefundAddress] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    getAnyTokenOptions(sessionId)
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        const first = loaded.origins[0];
        if (first) {
          setChainId(first.chainId);
          setToken(first.tokens[0]?.address ?? "");
        }
        const route = loaded.route;
        if (route && route.state !== "quoted" && route.state !== "failure" && route.state !== "refund") {
          setStage({ kind: "tracking", view: route });
        }
      })
      .catch((err: unknown) => active && setLoadError(messageOf(err, "Paying with other tokens is unavailable right now.")));
    return () => {
      active = false;
    };
  }, [sessionId]);

  const chain: OriginChainOption | undefined = useMemo(
    () => options?.origins.find((entry) => entry.chainId === chainId),
    [options, chainId],
  );
  const depositOnly = chain?.vm === "svm";
  const deposit = depositOnly || useDeposit;

  useEffect(() => {
    if (stage.kind !== "quoted") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [stage.kind]);

  const requestQuote = useCallback(
    async (wallet: Eip6963ProviderDetail | null) => {
      if (chain === undefined || token === "") return;
      const problems = validateFields(requiredFields, fields);
      if (problems.length > 0) {
        setError(problems.join(" "));
        return;
      }
      setError(null);
      try {
        let account: string | null = null;
        if (wallet !== null) {
          setStage({ kind: "working", step: `Connecting to ${wallet.info.name}…` });
          account = await connect(wallet);
        }
        const originAddress = account ?? refundAddress.trim();
        if (originAddress === "") throw new Error(`Enter your ${chain.name} wallet address for refunds.`);
        setStage({ kind: "working", step: "Finding the best route…" });
        const quote = await requestRouteQuote(sessionId, {
          originChainId: chain.chainId,
          originToken: token,
          originAddress,
          depositAddress: deposit,
          fields,
        });
        setNow(Date.now());
        setStage({ kind: "quoted", quote, account, walletId: wallet?.info.uuid ?? null });
      } catch (err) {
        setError(messageOf(err, "No route is available for this payment."));
        setStage({ kind: "choose" });
      }
    },
    [chain, token, requiredFields, fields, refundAddress, deposit, sessionId],
  );

  const execute = useCallback(
    async (wallet: Eip6963ProviderDetail, quote: RouteQuoteView, account: string) => {
      setError(null);
      try {
        setStage({ kind: "working", step: `Switching to ${chain?.name ?? "the origin chain"}…` });
        await switchChain(wallet, quote.origin.chainId, chain?.name ?? "the origin chain");
        const originTxHash = await executeSteps(wallet, quote, account, (step) => setStage({ kind: "working", step }));
        setStage({ kind: "tracking", view: null, originTxHash });
      } catch (err) {
        setError(messageOf(err, "The wallet did not send the payment."));
        setStage({ kind: "quoted", quote, account, walletId: wallet.info.uuid });
      }
    },
    [chain],
  );

  const tracking = stage.kind === "tracking";
  const trackedHash = stage.kind === "tracking" ? stage.originTxHash : undefined;
  useEffect(() => {
    if (!tracking) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const view = await getRouteStatus(sessionId, trackedHash);
        if (!active) return;
        setStage({ kind: "tracking", view, ...(trackedHash ? { originTxHash: trackedHash } : {}) });
        if (FINAL_ROUTE_STATES.has(view.state)) return;
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.status < 500) {
          setError(err.message);
          return;
        }
        // Provider or network hiccup: keep polling.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [tracking, trackedHash, sessionId]);

  const depositQr = useMemo(() => {
    if (stage.kind !== "quoted" || stage.quote.depositUri === null) return null;
    return renderSVG(stage.quote.depositUri, { ecc: "M", pixelSize: 5, blackColor: "#18211c", whiteColor: "#f3f4ec" });
  }, [stage]);

  if (loadError) {
    return (
      <div className="alert alert-info" role="status">
        {loadError}
      </div>
    );
  }
  if (options === null) return <p className="muted">Loading payment routes…</p>;
  if (!options.available) {
    return (
      <div className="alert alert-info" role="status">
        {options.reason ?? "Paying with other tokens is not available for this checkout."}
      </div>
    );
  }

  if (stage.kind === "tracking") {
    const view = stage.view;
    const final = view !== null && FINAL_ROUTE_STATES.has(view.state);
    return (
      <div className="any-token">
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className={`alert ${view?.state === "paid" ? "alert-success" : view && final ? "alert-error" : "alert-info"}`} role="status">
          <div className="solana-waiting">
            {!final ? <span className="pulse" aria-hidden="true" /> : null}
            <strong>{routeProgressLabel(view ?? { state: "waiting" }, networkName)}</strong>
          </div>
          {view?.message && view.state !== "paid" ? <p className="muted">{view.message}</p> : null}
          {view?.originTxHash ? (
            <div>
              Origin:{" "}
              {view.originExplorerUrl ? (
                <a className="link mono" href={view.originExplorerUrl} target="_blank" rel="noreferrer">
                  {shortHash(view.originTxHash)}
                </a>
              ) : (
                <span className="mono">{shortHash(view.originTxHash)}</span>
              )}
            </div>
          ) : null}
          {view?.destinationTxHash ? (
            <div>
              Delivery on {networkName}:{" "}
              {view.destinationExplorerUrl ? (
                <a className="link mono" href={view.destinationExplorerUrl} target="_blank" rel="noreferrer">
                  {shortHash(view.destinationTxHash)}
                </a>
              ) : (
                <span className="mono">{shortHash(view.destinationTxHash)}</span>
              )}
            </div>
          ) : null}
          {view?.state === "refund" ? (
            <p>
              Refunded to <span className="mono">{shortHash(view.refundTo)}</span> on the origin chain
              {view.refundTxHash ? (
                <>
                  {" "}
                  (
                  {view.refundExplorerUrl ? (
                    <a className="link mono" href={view.refundExplorerUrl} target="_blank" rel="noreferrer">
                      {shortHash(view.refundTxHash)}
                    </a>
                  ) : (
                    <span className="mono">{shortHash(view.refundTxHash)}</span>
                  )}
                  )
                </>
              ) : null}
              . You can try again or pay another way.
            </p>
          ) : null}
          {view?.state === "failure" ? (
            <p>If funds left your wallet, the route provider refunds them to {shortHash(view.refundTo)}.</p>
          ) : null}
          {view?.state === "paid" ? (
            <div className="solana-paid-actions">
              <Link className="btn btn-primary" href={`/c/${sessionId}/success`}>
                View your access
              </Link>
            </div>
          ) : null}
        </div>
        {view !== null && (view.state === "refund" || view.state === "failure") ? (
          <button type="button" className="btn btn-small" onClick={() => setStage({ kind: "choose" })}>
            Try another route
          </button>
        ) : null}
      </div>
    );
  }

  const busy = stage.kind === "working";
  const quote = stage.kind === "quoted" ? stage.quote : null;
  const expired = quote !== null && remainingMs(quote.expiresAt, now) === 0;
  return (
    <div className="any-token">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="hint">
        Pay from another chain or token. A route provider converts and delivers exactly <strong>{amountLabel}</strong> to
        the merchant on {networkName}; if the route fails, your funds are refunded to your wallet.
      </p>

      {quote === null ? (
        <>
          <div className="payto-row">
            <label className="label" htmlFor="any-token-chain">
              Pay from
            </label>
            <select
              id="any-token-chain"
              className="input"
              value={chainId ?? ""}
              disabled={busy}
              onChange={(event) => {
                const next = options.origins.find((entry) => entry.chainId === Number(event.target.value));
                setChainId(next?.chainId ?? null);
                setToken(next?.tokens[0]?.address ?? "");
              }}
            >
              {options.origins.map((entry) => (
                <option key={entry.chainId} value={entry.chainId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="payto-row">
            <label className="label" htmlFor="any-token-token">
              Token
            </label>
            <select id="any-token-token" className="input" value={token} disabled={busy} onChange={(event) => setToken(event.target.value)}>
              {chain?.tokens.map((entry) => (
                <option key={entry.address} value={entry.address}>
                  {entry.symbol}
                </option>
              ))}
            </select>
          </div>
          {!depositOnly ? (
            <label className="checkbox-row">
              <input type="checkbox" checked={useDeposit} disabled={busy} onChange={(event) => setUseDeposit(event.target.checked)} />
              Pay by sending to a deposit address (QR, any wallet or exchange)
            </label>
          ) : null}
          <BuyerFields idPrefix="any-token" requiredFields={requiredFields} fields={fields} onChange={setField} disabled={busy} />
          {deposit ? (
            <>
              <div className="field">
                <label htmlFor="any-token-refund">Your {chain?.name ?? ""} wallet address (for refunds)</label>
                <input
                  id="any-token-refund"
                  className="input mono"
                  value={refundAddress}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => setRefundAddress(event.target.value)}
                />
              </div>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void requestQuote(null)}>
                Get deposit address
              </button>
            </>
          ) : (
            <div className="solana-wallets">
              {wallets.length === 0 ? (
                <p className="muted solana-note">No browser wallet detected. Use the deposit address option instead.</p>
              ) : (
                wallets.map((wallet) => (
                  <button key={wallet.info.uuid} type="button" className="btn wallet-btn" disabled={busy} onClick={() => void requestQuote(wallet)}>
                    {wallet.info.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallet.info.icon} alt="" width={20} height={20} />
                    ) : null}
                    <span>{`Quote with ${wallet.info.name}`}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <div className="route-quote">
          <div className="payto-row">
            <span className="label">You pay</span>
            <span className="line-amount">
              {quote.origin.formatted} {quote.origin.symbol} <span className="muted">({formatUsd(quote.origin.amountUsd)})</span>
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Merchant receives</span>
            <span>
              {quote.destination.formatted} {quote.destination.symbol} on {networkName}
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Route fee</span>
            <span>
              {formatUsd(quote.fees.totalUsd)} ({formatBps(quote.fees.feeBps)}){quote.fees.appUsd && Number(quote.fees.appUsd) > 0 ? `, incl. ${formatUsd(quote.fees.appUsd)} service fee` : ""}
            </span>
          </div>
          {quote.fees.gasUsd !== null ? (
            <div className="payto-row">
              <span className="label">Network gas</span>
              <span>≈ {formatUsd(quote.fees.gasUsd)}</span>
            </div>
          ) : null}
          <div className="payto-row">
            <span className="label">Route</span>
            <span>
              {quote.provider === "relay" ? "Relay" : "LI.FI"}
              {quote.timeEstimateSec !== null ? ` · about ${Math.max(1, Math.round(quote.timeEstimateSec))} s` : ""} · refunds to{" "}
              <span className="mono">{shortHash(quote.refundTo)}</span>
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Quote valid</span>
            <span className="badge badge-expiry">{expired ? "Expired" : formatCountdown(remainingMs(quote.expiresAt, now))}</span>
          </div>

          {expired ? (
            <button type="button" className="btn btn-primary" onClick={() => setStage({ kind: "choose" })}>
              Get a new quote
            </button>
          ) : quote.depositAddress !== null ? (
            <div className="evm-mobile">
              {depositQr !== null ? (
                <div
                  className="solana-qr evm-mobile-qr"
                  role="img"
                  aria-label={`Deposit QR code for ${quote.origin.formatted} ${quote.origin.symbol}`}
                  dangerouslySetInnerHTML={{ __html: depositQr }}
                />
              ) : null}
              <p>
                Send exactly <strong>{quote.origin.formatted} {quote.origin.symbol}</strong> to this one-time deposit address. Other
                amounts are refunded.
              </p>
              <div className="payto-row">
                <span className="mono">{quote.depositAddress}</span>
                <CopyButton value={quote.depositAddress} label="Copy" />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setStage({ kind: "tracking", view: null })}>
                I have sent it
              </button>
            </div>
          ) : quote.walletExecutable && stage.kind === "quoted" && stage.account !== null ? (
            wallets
              .filter((wallet) => wallet.info.uuid === stage.walletId)
              .map((wallet) => (
                <button
                  key={wallet.info.uuid}
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void execute(wallet, quote, stage.account as string)}
                >
                  {`Pay ${quote.origin.formatted} ${quote.origin.symbol} with ${wallet.info.name}`}
                </button>
              ))
          ) : (
            <p className="muted">This route cannot run in a browser wallet. Use the deposit address option.</p>
          )}
          {!expired ? (
            <button type="button" className="btn btn-small" onClick={() => setStage({ kind: "choose" })}>
              Change token
            </button>
          ) : null}
        </div>
      )}
      {stage.kind === "working" ? (
        <div className="solana-waiting muted" role="status">
          <span className="pulse" aria-hidden="true" />
          {stage.step}
        </div>
      ) : null}
    </div>
  );
}

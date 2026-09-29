"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import {
  ApiClientError,
  confirmCheckoutPayment,
  getZcashStatus,
  requestZcashUri,
  selectCheckoutNetwork,
} from "@/lib/api";
import { validateFields } from "@/lib/fields";
import { describeCountdown, formatCountdown, remainingMs, shortHash } from "@/lib/pay-display";
import { isWellFormedTxHash } from "@/lib/tx-hash";
import type { CollectedFieldSpec } from "@/lib/types";
import type { ZcashStatusResponse, ZcashUriResponse } from "@/lib/zcash-checkout";
import { BuyerFields, useBuyerFields } from "./BuyerFields";
import { CopyButton } from "./CopyButton";

interface ZcashPayProps {
  sessionId: string;
  /** e.g. "25 USDC" (the USD price the ZEC quote covers). */
  usdLabel: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Outcome = Exclude<ZcashStatusResponse, { status: "waiting" }>;

const POLL_INTERVAL_MS = 20_000;
const TERMINAL_STATUSES = new Set([404, 409, 410, 503]);

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiClientError || error instanceof Error ? error.message : fallback;
}

/** Ticks once a second while mounted. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Transparent Zcash checkout: collect delivery details, then show the
 * ZIP-321 QR for the locked ZEC amount with copyable address and exact
 * amount and a quote countdown. The page polls every 20 s; the server finds
 * the payment by its exact tagged amount and settles it after the required
 * confirmations. A payment made after the quote expired is held for review.
 */
export function ZcashPay({ sessionId, usdLabel, requiredFields, initialValues }: ZcashPayProps) {
  const { fields, setField } = useBuyerFields(requiredFields, initialValues);
  const [request, setRequest] = useState<ZcashUriResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const problems = validateFields(requiredFields, fields);
      if (problems.length > 0) {
        setError(problems.join(" "));
        return;
      }
      setError(null);
      setBusy(true);
      try {
        setRequest(await requestZcashUri(sessionId, fields));
      } catch (err) {
        setError(messageOf(err, "Could not prepare the Zcash payment."));
      } finally {
        setBusy(false);
      }
    },
    [requiredFields, fields, sessionId],
  );

  const requote = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await selectCheckoutNetwork(sessionId, "zcash");
      setRequest(await requestZcashUri(sessionId, fields));
    } catch (err) {
      setError(messageOf(err, "Could not lock a new ZEC price."));
    } finally {
      setBusy(false);
    }
  }, [sessionId, fields]);

  if (outcome?.status === "paid") return <ZcashPaid sessionId={sessionId} outcome={outcome} />;

  return (
    <div className="zcash-pay">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="muted zcash-note">
        Transparent payment, visible on-chain: the amount and both addresses are public. Shielded payments are not
        supported yet.
      </p>
      {request === null ? (
        <form onSubmit={start} noValidate>
          <BuyerFields idPrefix="zec" requiredFields={requiredFields} fields={fields} onChange={setField} disabled={busy} />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Locking a ZEC price…" : `Continue to pay ${usdLabel} in ZEC`}
          </button>
        </form>
      ) : (
        <ZcashRequest
          sessionId={sessionId}
          request={request}
          fields={fields}
          busy={busy}
          outcome={outcome}
          onOutcome={setOutcome}
          onRequote={requote}
          onError={setError}
        />
      )}
    </div>
  );
}

interface ZcashRequestProps {
  sessionId: string;
  request: ZcashUriResponse;
  fields: Record<string, string>;
  busy: boolean;
  outcome: Outcome | null;
  onOutcome: (outcome: Outcome) => void;
  onRequote: () => void;
  onError: (message: string | null) => void;
}

function ZcashRequest({ sessionId, request, fields, busy, outcome, onOutcome, onRequote, onError }: ZcashRequestProps) {
  const now = useNow();
  const [note, setNote] = useState<string | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(request.quoteExpired);
  const qrSvg = useMemo(
    () => renderSVG(request.uri, { ecc: "M", pixelSize: 6, blackColor: "#18211c", whiteColor: "#f3f4ec" }),
    [request.uri],
  );
  const left = remainingMs(request.quote.expiresAt, now);
  const expired = quoteExpired || left === 0;
  const stopPolling = outcome?.status === "review";

  useEffect(() => setQuoteExpired(request.quoteExpired), [request]);

  useEffect(() => {
    if (stopPolling) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await getZcashStatus(sessionId);
        if (!active) return;
        if (status.status === "waiting") {
          setNote(status.note ?? null);
          setQuoteExpired(status.quoteExpired);
        } else {
          onOutcome(status);
          if (status.status !== "confirming") return;
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && TERMINAL_STATUSES.has(err.status)) {
          onError(err.message);
          return;
        }
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, stopPolling, onOutcome, onError]);

  return (
    <div>
      {outcome?.status === "review" ? (
        <div className="alert alert-info" role="status">
          <strong>Payment under review.</strong> {outcome.message}{" "}
          <a className="link mono" href={outcome.explorerUrl} target="_blank" rel="noreferrer">
            {shortHash(outcome.txHash)}
          </a>
        </div>
      ) : null}
      {outcome?.status === "confirming" ? (
        <div className="alert alert-info" role="status">
          <div className="solana-waiting">
            <span className="pulse" aria-hidden="true" />
            Payment seen, waiting for {request.minConfirmations} confirmations (about{" "}
            {Math.max(1, Math.round((request.minConfirmations * 75) / 60))} min).
          </div>
          <a className="link mono" href={outcome.explorerUrl} target="_blank" rel="noreferrer">
            {shortHash(outcome.txHash)}
          </a>
        </div>
      ) : null}

      <div className="solana-grid">
        <div className="solana-qr" role="img" aria-label="Zcash payment request QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="solana-wallets">
          <div className="payto">
            <div className="payto-row">
              <span className="label">Send exactly</span>
              <CopyButton value={request.amountZec} label="Copy amount" />
            </div>
            <div className="mono zcash-amount">{request.amountZec} ZEC</div>
            <div className="muted zcash-small">
              {request.usdAmount} USD at {request.quote.rate} USD/ZEC ({request.quote.source}). The last digits identify
              your order: send the exact amount.
            </div>
          </div>
          <div className="payto">
            <div className="payto-row">
              <span className="label">To address</span>
              <CopyButton value={request.address} label="Copy address" />
            </div>
            <div className="mono zcash-address">{request.address}</div>
          </div>
          {expired ? (
            <div className="alert alert-error" role="alert">
              This price quote has expired. If you already sent the payment, keep this page open. Otherwise get a new
              quote before paying.
              <div>
                <button type="button" className="btn btn-small" onClick={onRequote} disabled={busy}>
                  {busy ? "Locking a new price…" : "Get a new quote"}
                </button>
              </div>
            </div>
          ) : (
            <div className="muted zcash-small" aria-live="off">
              Price locked for{" "}
              <span className="mono" aria-label={describeCountdown(left)}>
                {formatCountdown(left)}
              </span>
            </div>
          )}
          {outcome === null ? (
            <div className="solana-waiting muted" role="status">
              <span className="pulse" aria-hidden="true" />
              {note ?? "Waiting for payment"}
            </div>
          ) : null}
        </div>
      </div>
      <PasteTxid sessionId={sessionId} fields={fields} onOutcome={onOutcome} />
    </div>
  );
}

interface PasteTxidProps {
  sessionId: string;
  fields: Record<string, string>;
  onOutcome: (outcome: Outcome) => void;
}

/** Fallback: the buyer pastes their txid (e.g. the page was closed while paying). */
function PasteTxid({ sessionId, fields, onOutcome }: PasteTxidProps) {
  const [txid, setTxid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valid = isWellFormedTxHash("zcash", txid);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!valid) {
        setMessage("Enter the 64-character Zcash transaction id.");
        return;
      }
      setSubmitting(true);
      setMessage(null);
      const txHash = txid.trim().toLowerCase();
      const explorerUrl = `https://blockchair.com/zcash/transaction/${txHash}`;
      try {
        await confirmCheckoutPayment(sessionId, { txHash, fields });
        onOutcome({ status: "paid", txHash, explorerUrl });
      } catch (err) {
        if (err instanceof ApiClientError && err.pending) {
          onOutcome({ status: "confirming", txHash, explorerUrl, message: err.message });
        } else if (err instanceof ApiClientError && err.underReview) {
          onOutcome({ status: "review", txHash, explorerUrl, message: err.message });
        } else {
          setMessage(messageOf(err, "Could not check that transaction."));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [valid, txid, sessionId, fields, onOutcome],
  );

  return (
    <details className="zcash-paste">
      <summary>Already paid? Enter the transaction id</summary>
      <form onSubmit={onSubmit} noValidate>
        {message ? (
          <div className="alert alert-error" role="alert">
            {message}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="zcash-txid">Transaction id</label>
          <input
            id="zcash-txid"
            className={`input mono${txid.length > 0 && !valid ? " input-error" : ""}`}
            value={txid}
            placeholder="64 hex characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTxid(event.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Checking…" : "Check payment"}
        </button>
      </form>
    </details>
  );
}

function ZcashPaid({ sessionId, outcome }: { sessionId: string; outcome: Extract<Outcome, { status: "paid" }> }) {
  return (
    <div className="alert alert-success" role="status">
      <strong>Payment confirmed.</strong> Your ZEC payment is final and access is being delivered.
      <div className="solana-paid-actions">
        <a className="link mono" href={outcome.explorerUrl} target="_blank" rel="noreferrer">
          View on Blockchair ({shortHash(outcome.txHash)})
        </a>
        <Link className="btn btn-primary" href={`/c/${sessionId}/success`}>
          View your access
        </Link>
      </div>
    </div>
  );
}

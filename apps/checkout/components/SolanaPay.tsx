"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";

import {
  ApiClientError,
  getSolanaStatus,
  requestSolanaPayUrl,
  requestSolanaTransaction,
} from "@/lib/api";
import { validateFields } from "@/lib/fields";
import {
  payWithStandardWallet,
  solanaChainFor,
  useSolanaWallets,
  type StandardWallet,
} from "@/lib/solana-wallets";
import type { CollectedFieldSpec, SolanaPayUrlResponse } from "@/lib/types";

interface SolanaPayProps {
  sessionId: string;
  amountLabel: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Stage =
  | { kind: "details" }
  | { kind: "pay"; request: SolanaPayUrlResponse }
  | { kind: "paid"; txHash: string; explorerUrl: string };

const POLL_INTERVAL_MS = 2_000;
/** Statuses that will not change by polling again (bad session / verification). */
const TERMINAL_STATUSES = new Set([404, 409, 410, 422, 503]);

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiClientError || error instanceof Error ? error.message : fallback;
}

/**
 * Solana USDC checkout: collect delivery details, then pay by scanning the
 * Solana Pay QR with a phone wallet or with an installed browser wallet
 * (Wallet Standard). The page polls every 2s; the server finds the payment by
 * the session reference, verifies it on-chain, and delivers access once.
 */
export function SolanaPay({ sessionId, amountLabel, requiredFields, initialValues }: SolanaPayProps) {
  const [stage, setStage] = useState<Stage>({ kind: "details" });
  const [error, setError] = useState<string | null>(null);
  // Stable so the polling effect in PayStep is not restarted on every render.
  const onPaid = useCallback((txHash: string, explorerUrl: string) => {
    setError(null);
    setStage({ kind: "paid", txHash, explorerUrl });
  }, []);

  return (
    <div className="solana-pay">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {stage.kind === "details" ? (
        <DetailsStep
          sessionId={sessionId}
          amountLabel={amountLabel}
          requiredFields={requiredFields}
          initialValues={initialValues}
          onReady={(request) => setStage({ kind: "pay", request })}
          onError={setError}
        />
      ) : null}
      {stage.kind === "pay" ? (
        <PayStep
          sessionId={sessionId}
          amountLabel={amountLabel}
          request={stage.request}
          onPaid={onPaid}
          onError={setError}
        />
      ) : null}
      {stage.kind === "paid" ? (
        <PaidStep sessionId={sessionId} txHash={stage.txHash} explorerUrl={stage.explorerUrl} />
      ) : null}
    </div>
  );
}

interface DetailsStepProps {
  sessionId: string;
  amountLabel: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
  onReady: (request: SolanaPayUrlResponse) => void;
  onError: (message: string | null) => void;
}

function DetailsStep({ sessionId, amountLabel, requiredFields, initialValues, onReady, onError }: DetailsStepProps) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(requiredFields.map((spec) => [spec.key, initialValues[spec.key] ?? ""])),
  );
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const messages = validateFields(requiredFields, fields);
      if (messages.length > 0) {
        onError(messages.join(" "));
        return;
      }
      onError(null);
      setSubmitting(true);
      try {
        onReady(await requestSolanaPayUrl(sessionId, fields));
      } catch (err) {
        onError(messageOf(err, "Could not start the Solana payment."));
        setSubmitting(false);
      }
    },
    [requiredFields, fields, sessionId, onReady, onError],
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      {requiredFields.map((spec) => (
        <div className="field" key={spec.key}>
          <label htmlFor={`sol-field-${spec.key}`}>{spec.label}</label>
          <input
            id={`sol-field-${spec.key}`}
            className="input"
            type={spec.inputType}
            value={fields[spec.key] ?? ""}
            placeholder={spec.placeholder}
            autoComplete="off"
            onChange={(e) => {
              const value = e.target.value;
              setFields((prev) => ({ ...prev, [spec.key]: value }));
            }}
            required={spec.required}
          />
          <div className="help">{spec.help}</div>
        </div>
      ))}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Preparing payment…" : `Continue to pay ${amountLabel}`}
      </button>
    </form>
  );
}

interface PayStepProps {
  sessionId: string;
  amountLabel: string;
  request: SolanaPayUrlResponse;
  onPaid: (txHash: string, explorerUrl: string) => void;
  onError: (message: string | null) => void;
}

function PayStep({ sessionId, amountLabel, request, onPaid, onError }: PayStepProps) {
  const wallets = useSolanaWallets();
  const [sending, setSending] = useState<string | null>(null);
  const qrSvg = useMemo(
    () => renderSVG(request.transferUrl, { ecc: "M", pixelSize: 6, blackColor: "#18211c", whiteColor: "#f3f4ec" }),
    [request.transferUrl],
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await getSolanaStatus(sessionId);
        if (!active) return;
        if (status.status === "paid") {
          onPaid(status.txHash, status.explorerUrl);
          return;
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && TERMINAL_STATUSES.has(err.status)) {
          onError(err.message);
          return;
        }
        // Transient (RPC or network hiccup): keep polling.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, onPaid, onError]);

  const payWith = useCallback(
    async (wallet: StandardWallet) => {
      onError(null);
      setSending(wallet.name);
      try {
        await payWithStandardWallet(wallet, solanaChainFor(request.cluster), async (account) => {
          const tx = await requestSolanaTransaction(sessionId, account);
          return tx.transaction;
        });
      } catch (err) {
        onError(messageOf(err, "The wallet did not send the payment."));
      } finally {
        setSending(null);
      }
    },
    [request.cluster, sessionId, onError],
  );

  return (
    <div>
      <div className="alert alert-info">
        Pay <strong>{amountLabel}</strong> in USDC on Solana{request.cluster === "devnet" ? " (devnet)" : ""}. This
        page updates by itself once the payment lands.
      </div>
      <div className="solana-grid">
        <div className="solana-qr" aria-label="Solana Pay QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="solana-wallets">
          <div className="label">Scan with a Solana wallet, or pay here</div>
          {wallets.length === 0 ? (
            <p className="muted solana-note">No browser wallet detected. Scan the code with Phantom, Solflare or Backpack.</p>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.name}
                type="button"
                className="btn wallet-btn"
                disabled={sending !== null}
                onClick={() => payWith(wallet)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={wallet.icon} alt="" width={20} height={20} />
                <span>{sending === wallet.name ? "Waiting for wallet…" : `Pay with ${wallet.name}`}</span>
              </button>
            ))
          )}
          <div className="solana-waiting muted" role="status">
            <span className="pulse" aria-hidden="true" />
            Waiting for payment
          </div>
        </div>
      </div>
    </div>
  );
}

interface PaidStepProps {
  sessionId: string;
  txHash: string;
  explorerUrl: string;
}

function PaidStep({ sessionId, txHash, explorerUrl }: PaidStepProps) {
  return (
    <div className="alert alert-success solana-paid" role="status">
      <strong>Payment confirmed.</strong> Your USDC payment settled on Solana and access is being delivered.
      <div className="solana-paid-actions">
        {explorerUrl ? (
          <a className="link mono" href={explorerUrl} target="_blank" rel="noreferrer">
            View on Solscan ({`${txHash.slice(0, 8)}…${txHash.slice(-6)}`})
          </a>
        ) : null}
        <Link className="btn btn-primary" href={`/c/${sessionId}/success`}>
          View your access
        </Link>
      </div>
    </div>
  );
}

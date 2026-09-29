"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { createWalletClient, custom, getAddress } from "viem";
import type { PaymentNetwork } from "@settlekit/common";

import { ApiClientError, confirmCheckoutPayment, declareEvmPayer, getEvmParams } from "@/lib/api";
import type { EvmPaymentParams } from "@/lib/evm-checkout";
import {
  buildEip681TransferUri,
  buildTransferCall,
  isUserRejection,
  sendTransfer,
  switchOrAddChain,
  walletChainId,
  type Eip6963ProviderDetail,
  type Hex,
} from "@/lib/evm-wallet";
import { validateFields } from "@/lib/fields";
import { explorerLink, shortHash } from "@/lib/pay-display";
import type { CollectedFieldSpec } from "@/lib/types";
import { BuyerFields, useBuyerFields } from "./BuyerFields";
import { PaymentForm } from "./PaymentForm";
import { useEvmWallets } from "./useEvmWallets";

interface EvmPayProps {
  sessionId: string;
  network: PaymentNetwork;
  networkName: string;
  assetLabel: string;
  /** e.g. "25 USDG". */
  amountLabel: string;
  payToAddress: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Stage =
  | { kind: "ready" }
  | { kind: "working"; step: string }
  | { kind: "confirming"; txHash: Hex; message: string }
  | { kind: "paid"; txHash: Hex };

const POLL_INTERVAL_MS = 4_000;

function messageOf(error: unknown, fallback: string): string {
  if (isUserRejection(error)) return "The request was rejected in your wallet.";
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return (error as Error & { shortMessage?: string }).shortMessage ?? error.message;
  return fallback;
}

async function requestAccount(wallet: Eip6963ProviderDetail): Promise<Hex> {
  const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new Error("The wallet did not share an account.");
  return getAddress(first);
}

/**
 * EVM stablecoin checkout: connect an installed wallet (EIP-6963), bind it
 * as the payer, switch to (or add) the session's chain, send the exact
 * ERC-20 transfer (TIP-20 transferWithMemo on Tempo) with viem, then poll
 * until the chain reaches the required depth. Paying from another app is
 * always possible through the manual transaction-hash form.
 */
export function EvmPay(props: EvmPayProps) {
  const { sessionId, networkName, assetLabel, amountLabel, requiredFields, initialValues } = props;
  const wallets = useEvmWallets();
  const { fields, setField } = useBuyerFields(requiredFields, initialValues);
  const [params, setParams] = useState<EvmPaymentParams | null>(null);
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let active = true;
    getEvmParams(sessionId)
      .then((loaded) => active && setParams(loaded))
      .catch((err: unknown) => {
        if (!active) return;
        setParamsError(messageOf(err, "Wallet payments are unavailable for this network."));
        setManual(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const payWith = useCallback(
    async (wallet: Eip6963ProviderDetail) => {
      if (params === null) return;
      const problems = validateFields(requiredFields, fields);
      if (problems.length > 0) {
        setError(problems.join(" "));
        return;
      }
      setError(null);
      try {
        setStage({ kind: "working", step: `Connecting to ${wallet.info.name}…` });
        const account = await requestAccount(wallet);
        await declareEvmPayer(sessionId, account, fields);

        setStage({ kind: "working", step: `Switching to ${params.chainName}…` });
        await switchOrAddChain(wallet.provider, params.addChain);
        if ((await walletChainId(wallet.provider)) !== params.chainId) {
          throw new Error(`Switch your wallet to ${params.chainName} and try again.`);
        }

        setStage({ kind: "working", step: "Confirm the payment in your wallet…" });
        const client = createWalletClient({ transport: custom(wallet.provider) });
        const call = buildTransferCall({
          token: params.token.address,
          payTo: params.payTo,
          amountBase: params.amountBase,
          memo: params.memo,
        });
        const txHash = await sendTransfer(client, account, call);
        setStage({ kind: "confirming", txHash, message: "Waiting for the network to confirm your payment." });
      } catch (err) {
        setError(messageOf(err, "The wallet did not send the payment."));
        setStage({ kind: "ready" });
      }
    },
    [params, requiredFields, fields, sessionId],
  );

  const confirmingHash = stage.kind === "confirming" ? stage.txHash : null;
  useEffect(() => {
    if (confirmingHash === null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await confirmCheckoutPayment(sessionId, { txHash: confirmingHash, fields });
        if (active) setStage({ kind: "paid", txHash: confirmingHash });
        return;
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.pending) {
          setStage({ kind: "confirming", txHash: confirmingHash, message: err.message });
        } else if (err instanceof ApiClientError) {
          setError(err.message);
          return;
        }
        // Network hiccups and pending confirmations: keep polling.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [confirmingHash, sessionId, fields]);

  // Mobile wallets: EIP-681 transfer request as a QR, then paste the hash.
  const mobileQr = useMemo(() => {
    if (params === null) return null;
    const uri = buildEip681TransferUri({
      token: params.token.address,
      chainId: params.chainId,
      payTo: params.payTo,
      amountBase: params.amountBase,
    });
    return renderSVG(uri, { ecc: "M", pixelSize: 5, blackColor: "#18211c", whiteColor: "#f3f4ec" });
  }, [params]);

  const explorerUrl =
    stage.kind === "confirming" || stage.kind === "paid" ? explorerLink(params?.explorerTxBase ?? null, stage.txHash) : "";

  if (stage.kind === "paid") {
    return (
      <div className="alert alert-success" role="status">
        <strong>Payment confirmed.</strong> Your {assetLabel} payment settled on {networkName} and access is being delivered.
        <div className="solana-paid-actions">
          {explorerUrl ? (
            <a className="link mono" href={explorerUrl} target="_blank" rel="noreferrer">
              View transaction ({shortHash(stage.txHash)})
            </a>
          ) : null}
          <Link className="btn btn-primary" href={`/c/${sessionId}/success`}>
            View your access
          </Link>
        </div>
      </div>
    );
  }

  const busy = stage.kind === "working" || stage.kind === "confirming";
  return (
    <div className="evm-pay">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {paramsError ? (
        <div className="alert alert-info" role="status">
          {paramsError} You can still pay from any wallet and paste the transaction hash below.
        </div>
      ) : null}

      {stage.kind === "confirming" ? (
        <div className="alert alert-info" role="status">
          <div className="solana-waiting">
            <span className="pulse" aria-hidden="true" />
            {stage.message}
          </div>
          {explorerUrl ? (
            <a className="link mono" href={explorerUrl} target="_blank" rel="noreferrer">
              View transaction ({shortHash(stage.txHash)})
            </a>
          ) : (
            <span className="mono">{shortHash(stage.txHash)}</span>
          )}
        </div>
      ) : null}

      {!manual && params !== null && stage.kind !== "confirming" ? (
        <>
          <div className="alert alert-info">
            Pay <strong>{amountLabel}</strong> on <strong>{networkName}</strong> from your wallet. The page updates by
            itself once the payment is final ({params.minConfirmations} confirmation
            {params.minConfirmations === 1 ? "" : "s"}).
          </div>
          <BuyerFields idPrefix="evm" requiredFields={requiredFields} fields={fields} onChange={setField} disabled={busy} />
          <div className="solana-wallets">
            {wallets.length === 0 ? (
              <p className="muted solana-note">
                No browser wallet detected. Install one (MetaMask, Rabby, Coinbase Wallet) or pay from another app below.
              </p>
            ) : (
              wallets.map((wallet) => (
                <button
                  key={wallet.info.uuid}
                  type="button"
                  className="btn wallet-btn"
                  disabled={busy}
                  onClick={() => void payWith(wallet)}
                >
                  {wallet.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wallet.info.icon} alt="" width={20} height={20} />
                  ) : null}
                  <span>{`Pay with ${wallet.info.name}`}</span>
                </button>
              ))
            )}
            {stage.kind === "working" ? (
              <div className="solana-waiting muted" role="status">
                <span className="pulse" aria-hidden="true" />
                {stage.step}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-small evm-manual-toggle" onClick={() => setManual(true)} disabled={busy}>
            Paid from another app? Enter the transaction hash
          </button>
        </>
      ) : null}

      {manual && stage.kind !== "confirming" ? (
        <>
          {mobileQr !== null ? (
            <div className="evm-mobile">
              <div
                className="solana-qr evm-mobile-qr"
                role="img"
                aria-label={`Payment request QR code for ${amountLabel} on ${networkName}`}
                dangerouslySetInnerHTML={{ __html: mobileQr }}
              />
              <p className="muted solana-note">
                Scan with a mobile wallet that supports payment requests (EIP-681), send the payment, then paste the
                transaction hash below.
              </p>
            </div>
          ) : null}
          <PaymentForm
            sessionId={sessionId}
            amountLabel={amountLabel}
            payToAddress={params?.payTo ?? props.payToAddress}
            network={props.network}
            networkName={networkName}
            assetLabel={assetLabel}
            requiredFields={requiredFields}
            initialValues={fields}
          />
          {params !== null ? (
            <button type="button" className="btn btn-small evm-manual-toggle" onClick={() => setManual(false)}>
              Pay with a browser wallet instead
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

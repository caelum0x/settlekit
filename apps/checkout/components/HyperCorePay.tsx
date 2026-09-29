"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";

import { ApiClientError, getHyperCoreParams, getHyperCoreStatus, submitHyperCoreTransfer } from "@/lib/api";
import { isUserRejection, walletChainId, type Eip6963ProviderDetail, type Hex } from "@/lib/evm-wallet";
import { validateFields } from "@/lib/fields";
import type { HyperCorePaymentParams, HyperCoreStatusResponse } from "@/lib/hypercore-checkout";
import { shortHash } from "@/lib/pay-display";
import type { CollectedFieldSpec } from "@/lib/types";
import { BuyerFields, useBuyerFields } from "./BuyerFields";
import { PaymentForm } from "./PaymentForm";
import { useEvmWallets } from "./useEvmWallets";

interface HyperCorePayProps {
  sessionId: string;
  networkName: string;
  /** e.g. "25 USDC". */
  amountLabel: string;
  payToAddress: string;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

type Stage =
  | { kind: "ready" }
  | { kind: "working"; step: string }
  | { kind: "waiting"; nonce: number; message: string }
  | { kind: "paid"; txHash: string; explorerUrl: string };

const POLL_INTERVAL_MS = 3_000;

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

/** Sign the usdSend with the wallet on whatever chain it is connected to. */
async function signUsdSend(wallet: Eip6963ProviderDetail, account: Hex, params: HyperCorePaymentParams) {
  const chainId = await walletChainId(wallet.provider);
  const action = {
    type: "usdSend" as const,
    signatureChainId: `0x${chainId.toString(16)}`,
    hyperliquidChain: params.hyperliquidChain,
    destination: params.destination,
    amount: params.amount,
    time: Date.now(),
  };
  const client = createWalletClient({ transport: custom(wallet.provider) });
  const signature = await client.signTypedData({
    account,
    domain: { ...params.domain, chainId },
    types: params.types,
    primaryType: params.primaryType,
    message: {
      hyperliquidChain: action.hyperliquidChain,
      destination: action.destination,
      amount: action.amount,
      time: BigInt(action.time),
    },
  });
  return { action, signature };
}

/**
 * HyperCore (Hyperliquid L1) USDC checkout: the buyer's EVM wallet
 * (EIP-6963) signs a Hyperliquid `usdSend` — a signature, not an on-chain
 * transaction, so no gas and no chain switch — which the server validates,
 * submits and verifies in the payee's ledger. Paying from Hyperliquid's own
 * app works too: paste the transfer hash in the manual form.
 */
export function HyperCorePay(props: HyperCorePayProps) {
  const { sessionId, networkName, amountLabel, requiredFields, initialValues } = props;
  const wallets = useEvmWallets();
  const { fields, setField } = useBuyerFields(requiredFields, initialValues);
  const [params, setParams] = useState<HyperCorePaymentParams | null>(null);
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let active = true;
    getHyperCoreParams(sessionId)
      .then((loaded) => active && setParams(loaded))
      .catch((err: unknown) => {
        if (!active) return;
        setParamsError(messageOf(err, "Wallet payments are unavailable for HyperCore right now."));
        setManual(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const apply = useCallback((result: HyperCoreStatusResponse) => {
    if (result.status === "paid") setStage({ kind: "paid", txHash: result.txHash, explorerUrl: result.explorerUrl });
    else if (result.status === "waiting") setStage({ kind: "waiting", nonce: result.nonce, message: "Waiting for Hyperliquid to record the transfer." });
    else {
      setError(result.reason);
      setStage({ kind: "ready" });
    }
  }, []);

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
        setStage({ kind: "working", step: "Sign the USDC transfer in your wallet (no gas)…" });
        const { action, signature } = await signUsdSend(wallet, account, params);
        setStage({ kind: "working", step: "Sending the transfer to Hyperliquid…" });
        apply(await submitHyperCoreTransfer(sessionId, { action, signature, fields }));
      } catch (err) {
        setError(messageOf(err, "The transfer was not sent."));
        setStage({ kind: "ready" });
      }
    },
    [params, requiredFields, fields, sessionId, apply],
  );

  const waitingNonce = stage.kind === "waiting" ? stage.nonce : null;
  useEffect(() => {
    if (waitingNonce === null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await getHyperCoreStatus(sessionId, waitingNonce);
        if (!active) return;
        if (result.status !== "waiting") {
          apply(result);
          return;
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.status < 500) {
          setError(err.message);
          return;
        }
        // Hyperliquid hiccup: keep polling.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [waitingNonce, sessionId, apply]);

  if (stage.kind === "paid") {
    return (
      <div className="alert alert-success" role="status">
        <strong>Payment confirmed.</strong> Your USDC transfer settled on {networkName} and access is being delivered.
        <div className="solana-paid-actions">
          <a className="link mono" href={stage.explorerUrl} target="_blank" rel="noreferrer">
            View transfer ({shortHash(stage.txHash)})
          </a>
          <Link className="btn btn-primary" href={`/c/${sessionId}/success`}>
            View your access
          </Link>
        </div>
      </div>
    );
  }

  const busy = stage.kind === "working" || stage.kind === "waiting";
  return (
    <div className="evm-pay">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {paramsError ? (
        <div className="alert alert-info" role="status">
          {paramsError} You can still send USDC on Hyperliquid and paste the transfer hash below.
        </div>
      ) : null}

      {stage.kind === "waiting" ? (
        <div className="alert alert-info" role="status">
          <div className="solana-waiting">
            <span className="pulse" aria-hidden="true" />
            {stage.message}
          </div>
        </div>
      ) : null}

      {!manual && params !== null && stage.kind !== "waiting" ? (
        <>
          <div className="alert alert-info">
            Pay <strong>{amountLabel}</strong> from your Hyperliquid (HyperCore) USDC balance. Your wallet signs a
            transfer message; nothing is sent from your EVM balance and no gas is needed.
          </div>
          <BuyerFields idPrefix="hypercore" requiredFields={requiredFields} fields={fields} onChange={setField} disabled={busy} />
          <div className="solana-wallets">
            {wallets.length === 0 ? (
              <p className="muted solana-note">
                No browser wallet detected. Install one (MetaMask, Rabby, Coinbase Wallet) or pay in the Hyperliquid app
                and paste the hash below.
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
            Sent it in the Hyperliquid app? Enter the transfer hash
          </button>
        </>
      ) : null}

      {manual && stage.kind !== "waiting" ? (
        <>
          <PaymentForm
            sessionId={sessionId}
            amountLabel={amountLabel}
            payToAddress={params?.destination ?? props.payToAddress}
            network="hypercore"
            networkName={networkName}
            assetLabel="USDC"
            requiredFields={requiredFields}
            initialValues={fields}
            intro={`Send exactly ${amountLabel} with Hyperliquid's "Send USDC" (perps balance) to the address below, then paste the transfer hash from the Hyperliquid explorer.`}
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

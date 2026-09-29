"use client";

/**
 * Per-network payment flows, split into their own client chunks: the browser
 * downloads only the flow for the network being paid (plus any-token routing
 * when offered). `next/dynamic` must run in a client module for the split to
 * reach the client bundle.
 */
import dynamic from "next/dynamic";

function Loading() {
  return <p className="muted">Loading payment options…</p>;
}

export const EvmPay = dynamic(() => import("./EvmPay").then((m) => m.EvmPay), { loading: Loading });
export const SolanaPay = dynamic(() => import("./SolanaPay").then((m) => m.SolanaPay), { loading: Loading });
export const ZcashPay = dynamic(() => import("./ZcashPay").then((m) => m.ZcashPay), { loading: Loading });
export const HyperCorePay = dynamic(() => import("./HyperCorePay").then((m) => m.HyperCorePay), { loading: Loading });
export const AnyTokenPay = dynamic(() => import("./AnyTokenPay").then((m) => m.AnyTokenPay), { loading: Loading });
export const WalletPay = dynamic(() => import("./WalletPay").then((m) => m.WalletPay), { loading: Loading });

"use client";

import { useEffect } from "react";

import { readEmbedOrigin } from "./EmbedBridge";

interface EmbedSuccessProps {
  sessionId: string;
  paymentId: string;
  /** Origins the seller allows to embed the checkout. */
  allowedOrigins: string[];
}

/** Tells the embedding site (embed.js) that the payment settled. */
export function EmbedSuccess({ sessionId, paymentId, allowedOrigins }: EmbedSuccessProps) {
  useEffect(() => {
    if (window.parent === window) return;
    const origin = readEmbedOrigin()?.toLowerCase();
    if (!origin || !allowedOrigins.includes(origin)) return;
    window.parent.postMessage({ type: "settlekit:success", sessionId, paymentId }, origin);
  }, [sessionId, paymentId, allowedOrigins]);
  return null;
}

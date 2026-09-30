"use client";

import { useEffect } from "react";

const KEY = "settlekit_embed_origin";

/**
 * Remembers, for this tab, the site that embedded the checkout
 * (`?embed_origin=` set by embed.js). Checkout redirects drop the query, so
 * the success page reads it back from sessionStorage.
 */
export function EmbedBridge() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const origin = params.get("embed_origin");
      if (origin && window.parent !== window) window.sessionStorage.setItem(KEY, origin);
    } catch {
      /* storage unavailable (privacy mode): embedding still works, no callback */
    }
  }, []);
  return null;
}

/** The remembered embedder origin, if any. */
export function readEmbedOrigin(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

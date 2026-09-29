"use client";

import { useState } from "react";
import { paymentLinkUrl } from "@/lib/config";

interface ShareLinkProps {
  slug: string;
  productName: string;
  priceUsd: string | null;
  /** Show the embeddable button snippet too. */
  showEmbed?: boolean;
}

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="copy-row">
        {multiline ? (
          <textarea className="textarea mono" readOnly value={value} rows={4} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input className="input mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        )}
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The product's reusable checkout link and an embeddable pay button. */
export function ShareLink({ slug, productName, priceUsd, showEmbed = true }: ShareLinkProps) {
  const url = paymentLinkUrl(slug);
  const label = `Buy ${productName}${priceUsd ? ` for $${priceUsd}` : ""}`;
  const snippet =
    `<a href="${url}" target="_blank" rel="noopener"\n` +
    `   style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1e40a2;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">\n` +
    `  ${escapeHtml(label)}\n</a>`;
  return (
    <div className="share-link">
      <CopyField label="Checkout link" value={url} />
      <p className="field-hint" style={{ marginTop: -6 }}>
        One link, reusable forever: every visit opens a fresh checkout. <a className="link" href={url} target="_blank" rel="noreferrer">Open it</a>
      </p>
      {showEmbed ? <CopyField label="Embed a pay button on your site" value={snippet} multiline /> : null}
    </div>
  );
}

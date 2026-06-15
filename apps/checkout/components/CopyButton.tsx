"use client";

import { useCallback, useState } from "react";

interface CopyButtonProps {
  value: string;
  label?: string;
}

/** Small copy-to-clipboard button with a transient "Copied" state. */
export function CopyButton({ value, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for non-secure contexts.
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

"use client";

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  value: string;
  /** Label shown when idle. Defaults to the value. */
  children?: ReactNode;
  /** Label shown briefly after a successful copy. Default "Copied". */
  copiedLabel?: ReactNode;
  /** How long the "copied" state persists, in ms. Default 1500. */
  resetMs?: number;
  className?: string;
}

async function writeClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("Clipboard API unavailable");
}

export function CopyButton(props: CopyButtonProps) {
  const { value, children, copiedLabel = "Copied", resetMs = 1500, className } = props;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    void writeClipboard(value)
      .then(() => {
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [value, resetMs]);

  const classes = ["sk-copy", copied ? "sk-copy-done" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  return createElement(
    "button",
    {
      type: "button",
      className: classes,
      onClick: handleCopy,
      title: `Copy ${value}`,
      "aria-live": "polite",
    },
    copied ? copiedLabel : (children ?? value),
  );
}

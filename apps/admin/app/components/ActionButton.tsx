"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ActionButtonProps {
  /** Endpoint to POST to. */
  readonly endpoint: string;
  /** Optional JSON body. */
  readonly body?: Record<string, unknown>;
  /** Button label. */
  readonly label: string;
  /** Tone class suffix: "ok" | "warn" | "danger". */
  readonly tone?: "ok" | "warn" | "danger";
  /** Message shown on success (otherwise the server message / generic). */
  readonly successText?: string;
}

/**
 * A self-contained action control: POSTs to a route handler, shows an inline
 * result, and refreshes server-component data so tables reflect the mutation.
 */
export function ActionButton({
  endpoint,
  body,
  label,
  tone,
  successText,
}: ActionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function run() {
    setResult(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error: string | null };
      if (!res.ok || !json.ok) {
        setResult({ ok: false, text: json.error ?? `Failed (${res.status})` });
        return;
      }
      setResult({ ok: true, text: successText ?? "Done" });
      startTransition(() => router.refresh());
    } catch (e) {
      setResult({
        ok: false,
        text: e instanceof Error ? e.message : "Request failed",
      });
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className={`btn${tone ? ` ${tone}` : ""}`}
        disabled={isPending}
        onClick={run}
      >
        {isPending ? "Working…" : label}
      </button>
      {result && (
        <span className={`toast ${result.ok ? "ok" : "danger"}`}>
          {result.text}
        </span>
      )}
    </span>
  );
}

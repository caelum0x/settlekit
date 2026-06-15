"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface RecheckAccessButtonProps {
  organizationId: string;
}

/**
 * Re-runs GitHub access reconciliation for the customer's organization. The API
 * promotes any pending repo invites that have since been accepted to "active".
 */
export function RecheckAccessButton({ organizationId }: RecheckAccessButtonProps) {
  const [state, setState] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleRecheck() {
    if (!organizationId) {
      setState("error");
      setMessage("No organization to reconcile.");
      return;
    }
    setState("checking");
    setMessage("");
    const { data, error } = await api.github.sync(organizationId);
    if (error || !data) {
      setState("error");
      setMessage(error ?? "Re-check failed.");
      return;
    }
    const activated = data.outcomes.filter((o) => o.action === "activated").length;
    setState("done");
    setMessage(
      activated > 0
        ? `Activated ${activated} pending invite${activated === 1 ? "" : "s"}.`
        : "No changes — access is up to date.",
    );
  }

  return (
    <div className="recheck">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleRecheck}
        disabled={state === "checking"}
      >
        {state === "checking" ? "Re-checking…" : "Re-check access"}
      </button>
      {message ? (
        <span className={`recheck-msg${state === "error" ? " recheck-msg-error" : ""}`}>
          {message}
        </span>
      ) : null}
    </div>
  );
}

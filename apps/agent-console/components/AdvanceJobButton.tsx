"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  isTerminal,
  nextStatus,
  type JobStatus,
} from "@/lib/agent-economy-types";
import { humanize } from "@/lib/format";

interface AdvanceJobButtonProps {
  jobId: string;
  status: JobStatus;
  /** Server action advancing the job to `to`; returns an error string or null. */
  action: (jobId: string, to: JobStatus) => Promise<string | null>;
}

/**
 * Advances a job to its next forward status (created → funded → submitted →
 * evaluated → settled). Disabled on terminal states. Refreshes server data on
 * success and surfaces transition errors (e.g. a 409 conflict) inline.
 */
export function AdvanceJobButton({ jobId, status, action }: AdvanceJobButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const to = nextStatus(status);
  const terminal = isTerminal(status);

  async function onAdvance() {
    if (to === null) return;
    setPending(true);
    setError(null);
    try {
      const err = await action(jobId, to);
      if (err) {
        setError(err);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setPending(false);
    }
  }

  if (terminal || to === null) {
    return (
      <button className="btn btn-ghost btn-sm" type="button" disabled>
        No further steps
      </button>
    );
  }

  return (
    <div className="advance-job">
      <button
        className="btn btn-primary btn-sm"
        type="button"
        onClick={onAdvance}
        disabled={pending}
      >
        {pending ? "Advancing…" : `Advance to ${humanize(to)}`}
      </button>
      {error ? (
        <div className="form-message err" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

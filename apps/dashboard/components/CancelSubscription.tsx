"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelSubscriptionAction } from "@/lib/billing-actions";

interface CancelSubscriptionProps {
  id: string;
  periodEnd: string | null;
}

/** Cancel at period end (default) or immediately; the buyer keeps paid access until then. */
export function CancelSubscription({ id, periodEnd }: CancelSubscriptionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(atPeriodEnd: boolean): Promise<void> {
    const when = atPeriodEnd && periodEnd ? `at the end of the paid period (${new Date(periodEnd).toLocaleDateString()})` : "now";
    if (!window.confirm(`Cancel this subscription ${when}? No further charges will be collected.`)) return;
    setPending(true);
    setError(null);
    const result = await cancelSubscriptionAction(id, atPeriodEnd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-actions">
      <button type="button" className="btn btn-small" disabled={pending} onClick={() => void cancel(true)}>
        Cancel at period end
      </button>
      <button type="button" className="btn btn-small btn-ghost" disabled={pending} onClick={() => void cancel(false)}>
        Cancel now
      </button>
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

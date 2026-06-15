import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCheckoutSession, expireCheckoutSession, ApiClientError } from "@/lib/api";
import { formatMoney, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { sessionId: string };
}

/**
 * Expired checkout page. Confirms the session is no longer payable. If the API
 * still reports the session as open (e.g. the buyer navigated here manually),
 * it is transitioned to expired via the real domain function before rendering.
 * Completed sessions are redirected to their success page.
 */
export default async function ExpiredPage({ params }: PageProps) {
  const { sessionId } = params;

  let amountLabel: string | null = null;
  let expiresLabel: string | null = null;

  try {
    const session = await getCheckoutSession(sessionId);
    if (session.status === "completed") {
      redirect(`/c/${sessionId}/success`);
    }
    // API returned an open/non-expired session — mark it expired so the state
    // is consistent with this page.
    await expireCheckoutSession(sessionId);
    amountLabel = formatMoney(session.amount);
    expiresLabel = formatTimestamp(session.expiresAt);
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.notFound) notFound();
      // 410 expired is the expected path — render the expired notice below.
    } else {
      throw error;
    }
  }

  return (
    <div>
      <div className="card center">
        <div className="big-status">Checkout expired</div>
        <p className="muted">
          This checkout session is no longer available and can&apos;t be paid.
        </p>
        {amountLabel ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Order total was <strong>{amountLabel}</strong>.
          </p>
        ) : null}
        {expiresLabel ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Expired at {expiresLabel}.
          </p>
        ) : null}
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          If you still want this product, ask the merchant for a fresh checkout
          link. Any payment sent to an expired session is not processed
          automatically — contact the seller if you have already paid.
        </p>
      </div>

      <div className="center">
        <Link className="link" href="/">
          Back to checkout
        </Link>
      </div>
    </div>
  );
}

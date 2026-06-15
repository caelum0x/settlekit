import Link from "next/link";

/** 404 page shown when a checkout session id is unknown. */
export default function NotFound() {
  return (
    <div className="card center">
      <div className="big-status">Checkout not found</div>
      <p className="muted">
        We couldn&apos;t find that checkout session. The link may be wrong or the
        session was removed.
      </p>
      <p style={{ marginTop: 16 }}>
        <Link className="link" href="/">
          Back to checkout
        </Link>
      </p>
    </div>
  );
}

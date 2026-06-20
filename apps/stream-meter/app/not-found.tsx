import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <div className="empty-title">Page not found</div>
      <p className="empty-message">This stream isn&apos;t metered here.</p>
      <div className="empty-action">
        <Link className="btn btn-primary" href="/">
          Back to the meter
        </Link>
      </div>
    </div>
  );
}

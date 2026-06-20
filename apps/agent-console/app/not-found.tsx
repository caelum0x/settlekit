import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <div className="empty-title">Page not found</div>
      <p className="empty-message">No agent, service, or proof lives at this route.</p>
      <div className="empty-action">
        <Link className="btn btn-primary" href="/">
          Back to console
        </Link>
      </div>
    </div>
  );
}

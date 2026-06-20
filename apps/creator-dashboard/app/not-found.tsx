import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <div className="empty-title">Page not found</div>
      <p className="empty-message">This statement line doesn&apos;t exist.</p>
      <div className="empty-action">
        <Link className="btn btn-primary" href="/">
          Back to statement
        </Link>
      </div>
    </div>
  );
}

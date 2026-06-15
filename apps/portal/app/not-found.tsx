import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state" style={{ marginTop: 40 }}>
      <p className="empty-title">Page not found</p>
      <p className="empty-body">
        The page you’re looking for doesn’t exist in the portal.
      </p>
      <div className="empty-action">
        <Link href="/" className="btn btn-secondary">
          Back to start
        </Link>
      </div>
    </div>
  );
}

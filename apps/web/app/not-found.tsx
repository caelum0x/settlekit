import Link from "next/link";
import { internalLinks } from "@/lib/links";

export default function NotFound() {
  return (
    <section className="section page-hero">
      <div className="container">
        <div className="ref">
          <span className="ref-no">§ 404</span>
          <span>Not on the ledger</span>
          <span className="ref-fill" aria-hidden="true" />
        </div>
        <h1 className="section-title">This page settled elsewhere</h1>
        <p className="section-desc">
          The page you're looking for doesn't exist. Head back to the homepage to
          keep exploring SettleKit.
        </p>
        <div className="hero-actions">
          <Link href={internalLinks.home} className="btn btn-primary btn-lg">
            Back to home
          </Link>
          <Link href={internalLinks.pricing} className="btn btn-ghost btn-lg">
            View pricing
          </Link>
        </div>
      </div>
    </section>
  );
}

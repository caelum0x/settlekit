import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchListing } from "@/lib/api";
import { Rating } from "@/app/components/Rating";
import { checkoutUrl } from "@/lib/checkout";
import {
  formatPrice,
  formatDate,
  networkLabel,
  pluralize,
} from "@/lib/format";

export const dynamic = "force-dynamic";

interface ListingPageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: ListingPageProps): Promise<Metadata> {
  const listing = await fetchListing(params.id);
  if (!listing) return { title: "Listing not found — SettleKit Marketplace" };
  return {
    title: `${listing.title} — SettleKit Marketplace`,
    description: listing.summary,
  };
}

export default async function ListingDetailPage({
  params,
}: ListingPageProps) {
  const listing = await fetchListing(params.id);
  if (!listing) notFound();

  const isFree = Number.parseFloat(listing.priceUsdc) === 0;
  const buyHref = listing.productId
    ? checkoutUrl({
        productId: listing.productId,
        listingId: listing.id,
      })
    : null;

  return (
    <article>
      <div className="breadcrumb">
        <Link href="/">Marketplace</Link> / {listing.title}
      </div>

      <div className="detail">
        <div>
          <h1>{listing.title}</h1>
          <p className="subtitle">{listing.summary}</p>

          <div className="tag-row" style={{ marginBottom: 18 }}>
            {listing.tags.map((tag) => (
              <Link key={tag} href={`/?tags=${encodeURIComponent(tag)}`}>
                <span className="tag">{tag}</span>
              </Link>
            ))}
          </div>

          <div className="panel">
            <h2>About this listing</h2>
            <ul className="meta-list">
              <li>
                <span className="k">Seller</span>
                <Link href={`/sellers/${listing.merchantSlug}`}>
                  {listing.merchantName}
                </Link>
              </li>
              <li>
                <span className="k">Published</span>
                <span>{formatDate(listing.createdAt)}</span>
              </li>
              <li>
                <span className="k">Reviews</span>
                <span>{pluralize(listing.ratingCount, "rating")}</span>
              </li>
              {listing.agentServiceId ? (
                <li>
                  <span className="k">Agent service</span>
                  <Link href={`/agents/${listing.agentServiceId}`}>
                    View metadata
                  </Link>
                </li>
              ) : null}
              <li>
                <span className="k">Settlement</span>
                <span>{networkLabel("USDC")} over x402</span>
              </li>
            </ul>
          </div>
        </div>

        <aside className="panel">
          <div className="price" style={{ fontSize: 28 }}>
            {formatPrice(listing.priceUsdc)}
          </div>
          <div style={{ margin: "8px 0 16px" }}>
            <Rating
              average={listing.ratingAverage}
              count={listing.ratingCount}
            />
          </div>

          {buyHref ? (
            <a className="btn" href={buyHref} style={{ width: "100%" }}>
              {isFree ? "Get it free" : "Buy with USDC"}
            </a>
          ) : (
            <Link
              className="btn"
              href={`/agents/${listing.agentServiceId}`}
              style={{ width: "100%" }}
            >
              View agent service
            </Link>
          )}

          <p
            className="subtitle"
            style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}
          >
            Checkout opens a hosted USDC session. You only pay on confirmation.
          </p>
        </aside>
      </div>
    </article>
  );
}

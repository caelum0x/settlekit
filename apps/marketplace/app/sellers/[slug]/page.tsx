import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchSeller } from "@/lib/api";
import { ListingCard } from "@/app/components/ListingCard";
import { AgentCard } from "@/app/components/AgentCard";
import { Rating } from "@/app/components/Rating";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

interface SellerPageProps {
  params: { slug: string };
}

export async function generateMetadata({
  params,
}: SellerPageProps): Promise<Metadata> {
  const seller = await fetchSeller(params.slug);
  if (!seller) return { title: "Seller not found — SettleKit Marketplace" };
  return {
    title: `${seller.displayName} — SettleKit Marketplace`,
    description: seller.bio,
  };
}

export default async function SellerProfilePage({
  params,
}: SellerPageProps) {
  const seller = await fetchSeller(params.slug);
  if (!seller) notFound();

  return (
    <article>
      <div className="breadcrumb">
        <Link href="/">Marketplace</Link> / Sellers / {seller.displayName}
      </div>

      <h1>{seller.displayName}</h1>
      <p className="subtitle">{seller.bio}</p>

      <div className="panel" style={{ marginBottom: 8 }}>
        <div className="stat-row">
          <div className="stat">
            <div className="num">{seller.publishedListings}</div>
            <div className="lbl">Published listings</div>
          </div>
          <div className="stat">
            <div className="num">{seller.agentServices.length}</div>
            <div className="lbl">Agent services</div>
          </div>
          <div className="stat">
            <div className="num">{pluralize(seller.totalRatings, "rating")}</div>
            <div className="lbl">Total reviews</div>
          </div>
          <div className="stat">
            <div className="num">
              <Rating
                average={seller.ratingAverage}
                count={seller.totalRatings}
              />
            </div>
            <div className="lbl">Overall rating</div>
          </div>
        </div>
        {seller.websiteUrl ? (
          <p style={{ marginTop: 14, marginBottom: 0 }}>
            <a className="pill net" href={seller.websiteUrl} rel="noreferrer">
              {seller.websiteUrl}
            </a>
          </p>
        ) : null}
      </div>

      <h2 className="section-title">Listings</h2>
      {seller.listings.length === 0 ? (
        <div className="empty">No published listings yet.</div>
      ) : (
        <div className="grid">
          {seller.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      <h2 className="section-title">Agent Services</h2>
      {seller.agentServices.length === 0 ? (
        <div className="empty">No published agent services yet.</div>
      ) : (
        <div className="grid">
          {seller.agentServices.map((service) => (
            <AgentCard key={service.id} service={service} />
          ))}
        </div>
      )}
    </article>
  );
}

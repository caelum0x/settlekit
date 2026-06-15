import Link from "next/link";
import type { ListingDTO } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { Rating } from "./Rating";

interface ListingCardProps {
  listing: ListingDTO;
}

/** Summary card for a marketplace listing in a grid. */
export function ListingCard({ listing }: ListingCardProps) {
  return (
    <Link href={`/listings/${listing.id}`} className="card">
      <h3>{listing.title}</h3>
      <p>{listing.summary}</p>
      <div className="tag-row">
        {listing.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="card-foot">
        <span className="price">{formatPrice(listing.priceUsdc)}</span>
        <Rating average={listing.ratingAverage} count={listing.ratingCount} />
      </div>
    </Link>
  );
}

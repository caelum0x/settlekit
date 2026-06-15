import { fetchListings, fetchListingTags } from "@/lib/api";
import { ListingCard } from "@/app/components/ListingCard";
import { ListingSearch } from "@/app/components/ListingSearch";
import {
  readList,
  readSort,
  readString,
  type RawSearchParams,
} from "@/lib/search-params";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: RawSearchParams;
}

export default async function MarketplaceHomePage({
  searchParams,
}: HomePageProps) {
  const q = readString(searchParams, "q") ?? "";
  const sort = readSort(searchParams);
  const activeTags = readList(searchParams, "tags");

  const [listings, allTags] = await Promise.all([
    fetchListings({
      ...(q ? { q } : {}),
      ...(activeTags.length > 0 ? { tags: activeTags } : {}),
      sort,
    }),
    fetchListingTags(),
  ]);

  return (
    <section>
      <h1>Marketplace</h1>
      <p className="subtitle">
        Published products and tools, settled in USDC. {listings.length} result
        {listings.length === 1 ? "" : "s"}.
      </p>

      <ListingSearch
        q={q}
        sort={sort}
        activeTags={activeTags}
        allTags={allTags}
      />

      {listings.length === 0 ? (
        <div className="empty">
          No listings match your search. Try clearing filters or a different
          keyword.
        </div>
      ) : (
        <div className="grid">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </section>
  );
}

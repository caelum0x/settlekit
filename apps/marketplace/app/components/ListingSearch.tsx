import Link from "next/link";

interface ListingSearchProps {
  /** Current free-text query. */
  q: string;
  /** Current sort selection. */
  sort: string;
  /** Currently-active tag filters. */
  activeTags: string[];
  /** All tags available as facets. */
  allTags: string[];
}

/**
 * Search + sort + tag-facet controls for the listings page. Implemented as a
 * plain GET form so search works with real query params and zero client JS.
 * Tag facets are links that toggle a tag in/out of the query string.
 */
export function ListingSearch({
  q,
  sort,
  activeTags,
  allTags,
}: ListingSearchProps) {
  return (
    <div>
      <form className="searchbar" method="get" action="/">
        <input
          type="search"
          name="q"
          placeholder="Search listings…"
          defaultValue={q}
          aria-label="Search listings"
        />
        <select name="sort" defaultValue={sort} aria-label="Sort listings">
          <option value="top">Top rated</option>
          <option value="new">Newest</option>
          <option value="price">Lowest price</option>
        </select>
        {activeTags.map((tag) => (
          <input key={tag} type="hidden" name="tags" value={tag} />
        ))}
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      <div className="facets">
        {allTags.map((tag) => {
          const active = activeTags.includes(tag);
          const nextTags = active
            ? activeTags.filter((t) => t !== tag)
            : [...activeTags, tag];
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (sort && sort !== "top") params.set("sort", sort);
          for (const t of nextTags) params.append("tags", t);
          const href = `/${params.toString() ? `?${params.toString()}` : ""}`;
          return (
            <Link
              key={tag}
              href={href}
              className={active ? "tag active" : "tag"}
              aria-pressed={active}
            >
              {tag}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

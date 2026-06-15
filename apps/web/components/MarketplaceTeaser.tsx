import { marketplaceTeaser } from "@/lib/content";
import { links } from "@/lib/links";

export function MarketplaceTeaser() {
  return (
    <section className="section section-muted">
      <div className="container">
        <div className="teaser">
          <div className="teaser-copy">
            <span className="eyebrow">Marketplace</span>
            <h2 className="section-title">{marketplaceTeaser.title}</h2>
            <p className="section-desc">{marketplaceTeaser.description}</p>
            <a href={links.marketplace} className="btn btn-primary">
              Explore the marketplace
            </a>
          </div>

          <ul className="teaser-points">
            {marketplaceTeaser.points.map((point) => (
              <li key={point}>
                <span className="price-check" aria-hidden="true">
                  ✓
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

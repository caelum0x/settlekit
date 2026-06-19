import { marketplaceTeaser } from "@/lib/content";
import { links } from "@/lib/links";

export function MarketplaceTeaser() {
  return (
    <section className="section section-ruled">
      <div className="container">
        <div className="ref">
          <span className="ref-no">§ 04</span>
          <span>Marketplace</span>
          <span className="ref-fill" aria-hidden="true" />
        </div>

        <div className="teaser">
          <div className="teaser-copy">
            <h2 className="section-title">{marketplaceTeaser.title}</h2>
            <p className="section-desc">{marketplaceTeaser.description}</p>
            <a href={links.marketplace} className="btn btn-primary">
              Explore the marketplace
            </a>
          </div>

          <ul className="teaser-points">
            {marketplaceTeaser.points.map((point) => (
              <li key={point} className="teaser-point">
                <span className="check" aria-hidden="true">
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

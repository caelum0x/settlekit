import { marketplaceFeeNote, pricingTiers } from "@/lib/content";
import { links } from "@/lib/links";

export function PricingTable() {
  return (
    <div className="pricing-wrap">
      <div className="pricing-grid">
        {pricingTiers.map((tier) => (
          <article
            key={tier.name}
            className={`price-card${tier.highlighted ? " price-card-featured" : ""}`}
          >
            {tier.highlighted ? (
              <span className="price-flag">Most popular</span>
            ) : null}

            <h3 className="price-name">{tier.name}</h3>
            <div className="price-amount">
              <span className="price-value">{tier.price}</span>
              {tier.cadence ? (
                <span className="price-cadence">{tier.cadence}</span>
              ) : null}
            </div>
            <p className="price-tagline">{tier.tagline}</p>

            <div className="price-fee">{tier.transactionFee}</div>

            <a
              href={links.dashboard}
              className={`btn price-cta${tier.highlighted ? " btn-primary" : " btn-outline"}`}
            >
              {tier.ctaLabel}
            </a>

            <ul className="price-features">
              {tier.features.map((feature) => (
                <li key={feature}>
                  <span className="check" aria-hidden="true">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <p className="pricing-note">{marketplaceFeeNote}</p>
    </div>
  );
}

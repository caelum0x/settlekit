import type { DeveloperTool, SellableItem } from "@/lib/content";

interface FeatureGridProps {
  refNo: string;
  eyebrow: string;
  title: string;
  description: string;
  items: ReadonlyArray<SellableItem | DeveloperTool>;
}

export function FeatureGrid({
  refNo,
  eyebrow,
  title,
  description,
  items,
}: FeatureGridProps) {
  return (
    <section className="section section-ruled">
      <div className="container">
        <div className="ref">
          <span className="ref-no">§ {refNo}</span>
          <span>{eyebrow}</span>
          <span className="ref-fill" aria-hidden="true" />
        </div>

        <div className="section-head">
          <h2 className="section-title">{title}</h2>
          <p className="section-desc">{description}</p>
        </div>

        <div className="ledger">
          <div className="ledger-grid">
            {items.map((item, i) => (
              <article key={item.title} className="ledger-item">
                <div className="ledger-item-head">
                  <span className="ledger-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="ledger-item-no">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="ledger-item-title">{item.title}</h3>
                <p className="ledger-item-desc">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

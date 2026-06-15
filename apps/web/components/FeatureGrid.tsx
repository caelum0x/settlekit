import type { DeveloperTool, SellableItem } from "@/lib/content";

interface FeatureGridProps {
  eyebrow: string;
  title: string;
  description: string;
  items: ReadonlyArray<SellableItem | DeveloperTool>;
}

export function FeatureGrid({
  eyebrow,
  title,
  description,
  items,
}: FeatureGridProps) {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="section-title">{title}</h2>
          <p className="section-desc">{description}</p>
        </div>

        <div className="feature-grid">
          {items.map((item) => (
            <article key={item.title} className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                {item.icon}
              </span>
              <h3 className="feature-card-title">{item.title}</h3>
              <p className="feature-card-desc">{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

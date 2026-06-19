import { links } from "@/lib/links";

interface CTAProps {
  title: string;
  description: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export function CTA({
  title,
  description,
  primaryLabel = "Open the dashboard",
  primaryHref = links.dashboard,
  secondaryLabel = "Read the docs",
  secondaryHref = links.docs,
}: CTAProps) {
  return (
    <section className="section section-ruled">
      <div className="container">
        <div className="cta">
          <div className="cta-copy">
            <div className="cta-eyebrow">Ready to settle</div>
            <h2 className="cta-title">{title}</h2>
            <p className="cta-desc">{description}</p>
          </div>
          <div className="cta-actions">
            <a href={primaryHref} className="btn btn-primary btn-lg">
              {primaryLabel}
            </a>
            <a href={secondaryHref} className="btn btn-outline btn-lg">
              {secondaryLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

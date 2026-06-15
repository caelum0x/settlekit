import { hero, trustStrip } from "@/lib/content";
import { links, internalLinks } from "@/lib/links";

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-inner">
        <span className="eyebrow">{hero.eyebrow}</span>
        <h1 className="hero-title">{hero.title}</h1>
        <p className="hero-subhead">{hero.subhead}</p>

        <div className="hero-actions">
          <a href={links.dashboard} className="btn btn-primary btn-lg">
            Open the dashboard
          </a>
          <a href={links.docs} className="btn btn-ghost btn-lg">
            Read the docs
          </a>
        </div>

        <p className="hero-subnote">
          Already selling?{" "}
          <a className="text-link" href={internalLinks.useCases}>
            See the five ways developers use SettleKit
          </a>
          .
        </p>

        <div className="trust-strip" aria-label="Built on">
          {trustStrip.map((item) => (
            <span key={item} className="trust-item">
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="hero-glow" aria-hidden="true" />
    </section>
  );
}

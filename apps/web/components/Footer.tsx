import Link from "next/link";
import { links, internalLinks } from "@/lib/links";

const columns = [
  {
    title: "Product",
    items: [
      { label: "Use cases", href: internalLinks.useCases, external: false },
      { label: "Pricing", href: internalLinks.pricing, external: false },
      { label: "Marketplace", href: links.marketplace, external: true },
      { label: "Dashboard", href: links.dashboard, external: true },
    ],
  },
  {
    title: "Developers",
    items: [
      { label: "Documentation", href: links.docs, external: true },
      { label: "SDKs", href: links.docs, external: true },
      { label: "Webhooks", href: links.docs, external: true },
      { label: "x402 middleware", href: links.docs, external: true },
    ],
  },
  {
    title: "Sell",
    items: [
      { label: "Private GitHub repos", href: internalLinks.useCases, external: false },
      { label: "SaaS plans", href: internalLinks.useCases, external: false },
      { label: "Paid APIs", href: internalLinks.useCases, external: false },
      { label: "AI agent services", href: internalLinks.useCases, external: false },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <div className="brand">
            <span className="brand-mark">◆</span>
            <span className="brand-name">SettleKit</span>
          </div>
          <p className="footer-tagline">
            Sell private repos, SaaS, APIs, templates, and AI tools in USDC — and
            automatically deliver access after payment.
          </p>
          <a href={links.github} className="footer-oss">
            Open source · self-host or use hosted cloud
          </a>
        </div>

        <div className="footer-cols">
          {columns.map((col) => (
            <div key={col.title} className="footer-col">
              <h4 className="footer-col-title">{col.title}</h4>
              <ul className="footer-list">
                {col.items.map((item) => (
                  <li key={item.label}>
                    {item.external ? (
                      <a href={item.href}>{item.label}</a>
                    ) : (
                      <Link href={item.href}>{item.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} SettleKit. All rights reserved.</span>
        <span>Settled in USDC.</span>
      </div>
    </footer>
  );
}

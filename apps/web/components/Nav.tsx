import Link from "next/link";
import { links, internalLinks } from "@/lib/links";

const navItems = [
  { href: internalLinks.useCases, label: "Use cases" },
  { href: internalLinks.pricing, label: "Pricing" },
  { href: links.docs, label: "Docs", external: true },
  { href: links.marketplace, label: "Marketplace", external: true },
];

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner container">
        <Link href={internalLinks.home} className="brand">
          <span className="brand-mark">◆</span>
          <span className="brand-name">SettleKit</span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {navItems.map((item) =>
            item.external ? (
              <a key={item.label} href={item.href} className="nav-link">
                {item.label}
              </a>
            ) : (
              <Link key={item.label} href={item.href} className="nav-link">
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="nav-actions">
          <a href={links.dashboard} className="btn btn-ghost">
            Sign in
          </a>
          <a href={links.dashboard} className="btn btn-primary">
            Start selling
          </a>
        </div>
      </div>
    </header>
  );
}

import Link from "next/link";
import { links, internalLinks } from "@/lib/links";
import { ONBOARDING_URL } from "@/lib/site";

const navItems = [
  { href: internalLinks.proof, label: "Live payments" },
  { href: internalLinks.useCases, label: "Use cases" },
  { href: internalLinks.pricing, label: "Pricing" },
  { href: internalLinks.integrate, label: "Integrate" },
  { href: links.docs, label: "Docs", external: true },
];

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner container">
        <Link href={internalLinks.home} className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="brand-logo" width={24} height={24} />
          <span>SettleKit</span>
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
          <a href={`${links.dashboard}/login`} className="btn btn-ghost">
            Sign in
          </a>
          <a href={ONBOARDING_URL} className="btn btn-primary">
            Start selling
          </a>
        </div>
      </div>
    </header>
  );
}

/**
 * Nav — the docs sidebar.
 *
 * Client component so it can highlight the active route via usePathname. Reads
 * its structure from lib/nav.ts (the single source of truth) and renders one
 * labelled group per NavSection.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "../lib/nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Documentation">
      <Link href="/" className="nav__brand">
        SettleKit Docs
      </Link>
      {NAV.map((section) => (
        <div className="nav__section" key={section.title}>
          <p className="nav__section-title">{section.title}</p>
          <ul className="nav__list">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={
                    isActive(pathname, item.href)
                      ? "nav__link nav__link--active"
                      : "nav__link"
                  }
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default Nav;

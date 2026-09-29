"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "nav-link active" : "nav-link"}>
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo" aria-hidden="true" />
        <span>SettleKit</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) =>
          group.collapsed ? (
            <details
              className="nav-group"
              key={group.title}
              open={group.items.some((i) => i.href !== "/" && isActive(pathname, i.href))}
            >
              <summary className="nav-group-title nav-summary">{group.title}</summary>
              <NavLinks items={group.items} pathname={pathname} />
            </details>
          ) : (
            <div className="nav-group" key={group.title}>
              <NavLinks items={group.items} pathname={pathname} />
            </div>
          ),
        )}
      </nav>
      <div className="sidebar-footer">
        <a href="/logout" className="sidebar-signout">
          Sign out
        </a>
        <span>Stablecoin payments on every chain</span>
      </div>
    </aside>
  );
}

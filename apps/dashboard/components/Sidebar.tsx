"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">◆</span>
        <span>SettleKit</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="nav-group-title">{group.title}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive(pathname, item.href) ? "nav-link active" : "nav-link"
                }
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a href="/logout" className="sidebar-signout">
          Sign out
        </a>
        <span>Commerce OS · USDC native</span>
      </div>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface PortalNavProps {
  customerId: string;
}

interface NavItem {
  label: string;
  segment: string;
}

const ITEMS: NavItem[] = [
  { label: "Overview", segment: "" },
  { label: "Purchases", segment: "purchases" },
  { label: "Subscriptions", segment: "subscriptions" },
  { label: "License Keys", segment: "license-keys" },
  { label: "API Keys", segment: "api-keys" },
  { label: "Access", segment: "access" },
  { label: "Downloads", segment: "downloads" },
];

export function PortalNav({ customerId }: PortalNavProps) {
  const pathname = usePathname() ?? "";
  const base = `/c/${encodeURIComponent(customerId)}`;

  return (
    <nav className="portal-nav" aria-label="Portal sections">
      {ITEMS.map((item) => {
        const href = item.segment ? `${base}/${item.segment}` : base;
        const active =
          item.segment === ""
            ? pathname === base || pathname === `${base}/`
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.segment || "overview"}
            href={href}
            className={`nav-link${active ? " nav-link-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

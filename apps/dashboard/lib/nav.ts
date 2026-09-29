// Sidebar navigation model. The first group is the everyday workspace (kept
// short on purpose); everything else lives under "More tools".

export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /** Collapsed by default. */
  collapsed?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Home", href: "/" },
      { label: "Payments", href: "/payments" },
      { label: "Products", href: "/products" },
      { label: "Customers", href: "/customers" },
      { label: "Balances", href: "/payouts" },
      { label: "Settings", href: "/settings" },
    ],
  },
  {
    title: "More tools",
    collapsed: true,
    items: [
      { label: "Setup guide", href: "/onboarding" },
      { label: "Analytics", href: "/analytics" },
      { label: "Subscriptions", href: "/subscriptions" },
      { label: "Entitlements", href: "/entitlements" },
      { label: "Refunds", href: "/refunds" },
      { label: "Disputes", href: "/disputes" },
      { label: "Invoices", href: "/invoices" },
      { label: "Coupons", href: "/coupons" },
      { label: "Bundles", href: "/bundles" },
      { label: "License keys", href: "/license-keys" },
      { label: "API keys", href: "/api-keys" },
      { label: "Files", href: "/files" },
      { label: "Delivery runs", href: "/delivery/runs" },
      { label: "GitHub access", href: "/github" },
      { label: "Discord access", href: "/discord" },
      { label: "Agent services", href: "/agent-services" },
      { label: "Webhooks", href: "/webhooks" },
    ],
  },
];

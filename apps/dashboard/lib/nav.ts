// Sidebar navigation model. Lists every section from plan §16 plus the
// §27 integration sections, grouped for the merchant dashboard.

export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/" },
      { label: "Analytics", href: "/analytics" },
    ],
  },
  {
    title: "Commerce",
    items: [
      { label: "Products", href: "/products" },
      { label: "Bundles", href: "/bundles" },
      { label: "Payments", href: "/payments" },
      { label: "Customers", href: "/customers" },
      { label: "Subscriptions", href: "/subscriptions" },
      { label: "Entitlements", href: "/entitlements" },
    ],
  },
  {
    title: "Access delivery",
    items: [
      { label: "License Keys", href: "/license-keys" },
      { label: "API Keys", href: "/api-keys" },
      { label: "Files", href: "/files" },
      { label: "Delivery", href: "/delivery/runs" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "GitHub Access", href: "/github" },
      { label: "Discord Access", href: "/discord" },
      { label: "SaaS Plans", href: "/saas/plans" },
      { label: "Agent Services", href: "/agent-services" },
      { label: "Escrow", href: "/escrow/tasks" },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Webhooks", href: "/webhooks" },
      { label: "Payouts", href: "/payouts" },
      { label: "Settings", href: "/settings" },
    ],
  },
];

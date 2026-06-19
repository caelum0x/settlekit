// Sidebar navigation for the creator dashboard — the surfaces a creator who
// earns per-citation / per-listen / per-second royalties actually needs.

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
    title: "Earnings",
    items: [
      { label: "Statement", href: "/" },
      { label: "Sources", href: "/sources" },
      { label: "Payouts", href: "/payouts" },
    ],
  },
  {
    title: "Attribution",
    items: [{ label: "Reuse & proofs", href: "/attribution" }],
  },
  {
    title: "Account",
    items: [{ label: "Wallet", href: "/settings/wallet" }],
  },
];

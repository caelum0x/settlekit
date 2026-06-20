// Sidebar navigation for the agent console — the surfaces an operator watching
// autonomous agents do commerce (discover, pay via x402, cite, prove) needs.

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
    title: "Operations",
    items: [
      { label: "Console", href: "/" },
      { label: "Agents", href: "/agents" },
    ],
  },
  {
    title: "Marketplace",
    items: [{ label: "Services", href: "/services" }],
  },
  {
    title: "Provenance",
    items: [{ label: "Citations & proofs", href: "/citations" }],
  },
];

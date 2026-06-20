// Sidebar navigation for the stream meter — the surfaces an operator of
// per-second USDC streaming payments (Lepton RFB 4) actually needs: the live
// meter, the active streams, and the settlement checkpoints.

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
    title: "Live",
    items: [{ label: "Meter", href: "/" }],
  },
  {
    title: "Streams",
    items: [{ label: "Active streams", href: "/streams" }],
  },
  {
    title: "Settlements",
    items: [{ label: "Checkpoints", href: "/settlements" }],
  },
];

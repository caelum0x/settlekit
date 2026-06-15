/**
 * Documentation navigation model.
 *
 * A single source of truth for the docs sidebar and in-page links. Grouped into
 * sections so the <Nav> component can render labelled groups. Every href maps to
 * a real route under app/.
 */

export interface NavItem {
  readonly title: string;
  readonly href: string;
  readonly description?: string;
}

export interface NavSection {
  readonly title: string;
  readonly items: ReadonlyArray<NavItem>;
}

export const NAV: ReadonlyArray<NavSection> = [
  {
    title: "Getting started",
    items: [
      {
        title: "Overview",
        href: "/",
        description: "What SettleKit is and how it fits together.",
      },
      {
        title: "Quickstart",
        href: "/quickstart",
        description: "Connect, create a product, set a price, share a checkout link.",
      },
    ],
  },
  {
    title: "Guides",
    items: [
      {
        title: "GitHub repo sales",
        href: "/guides/github-repo-sales",
        description: "Sell private repository access in USDC.",
      },
      {
        title: "SaaS billing",
        href: "/guides/saas-billing",
        description: "Plans, entitlements, and the verify SDK.",
      },
      {
        title: "Paid APIs (x402)",
        href: "/guides/paid-apis-x402",
        description: "Gate any Fetch handler behind a pay-per-call challenge.",
      },
      {
        title: "License keys",
        href: "/guides/license-keys",
        description: "Issue, verify, and activate offline license keys.",
      },
      {
        title: "Bundles",
        href: "/guides/bundles",
        description: "Group products into a single priced bundle.",
      },
      {
        title: "Agent services",
        href: "/guides/agent-services",
        description: "List machine-callable, x402-priced AI tools.",
      },
    ],
  },
  {
    title: "Reference",
    items: [
      {
        title: "API reference",
        href: "/api-reference",
        description: "Every REST endpoint exposed under /v1.",
      },
    ],
  },
];

/** Flat list of every item, useful for building prev/next links or sitemaps. */
export function flatNav(): ReadonlyArray<NavItem> {
  return NAV.flatMap((section) => section.items);
}

/** Find the nav item matching an exact pathname, if any. */
export function findByHref(href: string): NavItem | undefined {
  return flatNav().find((item) => item.href === href);
}

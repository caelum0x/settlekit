// Marketing copy and structured data sourced from plan §2, §29, §32, §34.
// Static content only — the marketing site makes no API calls.

export interface SellableItem {
  title: string;
  description: string;
  icon: string;
}

export interface HowItWorksStep {
  step: number;
  title: string;
  description: string;
}

export interface DeveloperTool {
  title: string;
  description: string;
  icon: string;
}

export interface UseCase {
  id: string;
  title: string;
  target: string;
  promise: string;
  detail: string;
}

export interface PricingFeature {
  label: string;
}

export interface PricingTier {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  transactionFee: string;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
}

// ---- §34 hero messaging ----
export const hero = {
  eyebrow: "SettleKit Commerce OS",
  title: "Sell your software in USDC",
  subhead:
    "SettleKit lets developers sell private GitHub repos, SaaS subscriptions, API access, AI tools, templates, datasets, license keys, and digital downloads. Connect GitHub, create a product, set a USDC price, and share your checkout link. We handle payment verification, access delivery, subscriptions, license keys, webhooks, and customer portals.",
} as const;

// ---- trust strip ----
export const trustStrip: string[] = [
  "Arc-native settlement",
  "Circle Gateway",
  "x402 agent payments",
  "GitHub App",
  "Discord access",
  "Open source core",
];

// ---- §2 / §34 "what you can sell" ----
export const sellableItems: SellableItem[] = [
  {
    title: "Private GitHub repos",
    description:
      "Connect GitHub, pick a repo, set a price. Buyers get automatic collaborator or team access on payment.",
    icon: "{ }",
  },
  {
    title: "SaaS plans",
    description:
      "Create plans, sell subscriptions, manage seats, and check entitlements with the SDK — no billing to build.",
    icon: "≡",
  },
  {
    title: "Paid APIs",
    description:
      "Wrap an endpoint with x402 middleware and charge humans and agents per call in USDC.",
    icon: "</>",
  },
  {
    title: "AI agent services",
    description:
      "Make your service discoverable and payable by autonomous agents over Circle Gateway and x402.",
    icon: "◆",
  },
  {
    title: "Digital downloads",
    description:
      "Sell ZIPs, datasets, and assets with signed, expiring download links delivered on payment.",
    icon: "↓",
  },
  {
    title: "License keys",
    description:
      "Issue and verify license or API keys automatically at checkout, with revocation on refund or expiry.",
    icon: "⚿",
  },
  {
    title: "Discord communities",
    description:
      "Sell paid access to a community — buyers get a Discord role on payment and lose it on expiry.",
    icon: "✦",
  },
];

// ---- §34 how it works ----
export const howItWorks: HowItWorksStep[] = [
  {
    step: 1,
    title: "Create product",
    description:
      "Pick what you're selling — repo, plan, API, download, license, or Discord access.",
  },
  {
    step: 2,
    title: "Set price",
    description:
      "Choose a one-time or recurring USDC price. Bundles can combine several deliverables.",
  },
  {
    step: 3,
    title: "Buyer pays",
    description:
      "Share a checkout link. SettleKit verifies the USDC payment on settlement.",
  },
  {
    step: 4,
    title: "Access delivered",
    description:
      "Repo access, license keys, downloads, and Discord roles are granted automatically.",
  },
];

// ---- §34 developer tools ----
export const developerTools: DeveloperTool[] = [
  {
    title: "SDKs",
    description:
      "Typed client and server SDKs to check entitlements, list products, and gate features in your app.",
    icon: "⌘",
  },
  {
    title: "Webhooks",
    description:
      "Signed events for payments, subscriptions, deliveries, and refunds — with replay for reliability.",
    icon: "⇄",
  },
  {
    title: "Entitlements",
    description:
      "Ask one question — does this customer have access? — and gate repos, features, and downloads.",
    icon: "✓",
  },
  {
    title: "x402 middleware",
    description:
      "Drop-in middleware that turns any HTTP endpoint into a pay-per-call API for humans and agents.",
    icon: "₳",
  },
];

// ---- §29 killer use cases ----
export const useCases: UseCase[] = [
  {
    id: "private-repo",
    title: "Sell my private repo in 5 minutes",
    target:
      "Indie hackers, template sellers, AI boilerplate sellers, open-source maintainers",
    promise: "Connect GitHub. Pick repo. Set price. Share link. We handle access.",
    detail:
      "Your best first wedge: turn a private repository into a paid product without writing any billing or access code. Buyers are added as collaborators on payment and removed on refund or expiry.",
  },
  {
    id: "saas-billing",
    title: "Add USDC billing to my SaaS without building billing",
    target: "Crypto SaaS, Web3 SaaS, AI SaaS, B2B tools",
    promise: "Create plans, check entitlements, sell subscriptions, manage seats.",
    detail:
      "Define plans and features once, then gate your app with a single entitlement check. SettleKit handles subscriptions, seats, upgrades, downgrades, and renewals in USDC.",
  },
  {
    id: "paid-api",
    title: "Monetize my API with one middleware",
    target: "API developers, data companies, AI tool builders",
    promise: "Wrap your endpoint. Agents and humans pay per call.",
    detail:
      "Add x402 middleware to an existing endpoint and start charging per request. Usage metering, API keys, and per-call USDC settlement are built in.",
  },
  {
    id: "developer-bundle",
    title: "Sell a complete developer bundle",
    target: "Course creators, template sellers, developer educators",
    promise:
      "One checkout can deliver GitHub repo + ZIP + license key + Discord role.",
    detail:
      "Combine multiple deliverables into a single product. A buyer pays once and the bundle delivery engine grants every piece of access automatically.",
  },
  {
    id: "agent-payments",
    title: "Let AI agents buy my service",
    target: "Future-facing AI infra builders",
    promise: "Make your API discoverable and payable by autonomous agents.",
    detail:
      "Expose agent-readable metadata and accept nanopayments over Circle Gateway and x402, so autonomous agents can discover, purchase, and call your service.",
  },
];

// ---- §32 pricing tiers ----
export const pricingTiers: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "/month",
    tagline: "Start selling your first products.",
    transactionFee: "1% transaction fee",
    features: [
      "3 products",
      "1 GitHub repo product",
      "Basic checkout",
      "Community support",
    ],
    ctaLabel: "Start free",
    highlighted: false,
  },
  {
    name: "Creator",
    price: "$19",
    cadence: "/month",
    tagline: "For sellers of repos, downloads, and licenses.",
    transactionFee: "0.75% transaction fee",
    features: [
      "20 products",
      "GitHub repo sales",
      "Digital downloads",
      "License keys",
      "Discord access",
    ],
    ctaLabel: "Choose Creator",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$49",
    cadence: "/month",
    tagline: "For SaaS and subscription businesses.",
    transactionFee: "0.5% transaction fee",
    features: [
      "SaaS plans",
      "API keys",
      "Subscriptions",
      "Webhooks",
      "Bundles",
      "Customer portal",
    ],
    ctaLabel: "Choose Pro",
    highlighted: true,
  },
  {
    name: "Business",
    price: "$199",
    cadence: "/month",
    tagline: "For teams, paid APIs, and agent payments.",
    transactionFee: "0.25% transaction fee",
    features: [
      "Team seats",
      "Usage billing",
      "Paid APIs",
      "x402 payments",
      "Advanced analytics",
      "Webhook replay",
    ],
    ctaLabel: "Choose Business",
    highlighted: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    tagline: "For private deployments and compliance needs.",
    transactionFee: "Custom transaction pricing",
    features: [
      "Private deployment",
      "Custom compliance",
      "Custom integrations",
      "SLA",
      "Dedicated support",
    ],
    ctaLabel: "Contact sales",
    highlighted: false,
  },
];

export const marketplaceFeeNote =
  "Marketplace fee: 5%–15% on marketplace-discovered sales. Sales through your own checkout links pay only your plan's transaction fee.";

export const marketplaceTeaser = {
  title: "A marketplace for humans and AI agents",
  description:
    "List your products and paid APIs with agent-readable metadata. Get discovered, earn reviews, and let autonomous agents find and pay for your service — all settled in USDC.",
  points: [
    "Public seller profiles and product listings",
    "Paid API listings with agent-readable metadata",
    "Ratings and reviews build buyer trust",
    "Discovery by both humans and autonomous agents",
  ],
} as const;

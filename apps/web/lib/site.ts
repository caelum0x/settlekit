// Landing-page facts in one place: pricing, the chains we settle on (with
// honest labels), the founder story, and the API the /proof page reads.

import { links } from "./links";

/**
 * Platform pricing. Free to start; a small fee per successful payment.
 * Keep in sync with the API's PLATFORM_FEE_BPS / PLATFORM_FEE_FIXED env.
 */
export const PRICING = {
  /** Fee per successful payment, in basis points (100 = 1%). */
  feeBps: Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_BPS ?? 100),
  /** Fixed fee per payment in USD. */
  fixedUsd: Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_FIXED ?? 0),
  monthlyUsd: 0,
} as const;

export function feeLabel(): string {
  const pct = `${(PRICING.feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return PRICING.fixedUsd > 0 ? `${pct} + $${PRICING.fixedUsd.toFixed(2)}` : pct;
}

/** SettleKit API base URL (the /proof page reads public data from it). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/** Where "Start selling" goes: straight into sign-up, then guided setup. */
export const ONBOARDING_URL = `${links.dashboard.replace(/\/+$/, "")}/signup`;

export interface ChainCard {
  name: string;
  asset: string;
  label?: string;
  detail: string;
}

export const CHAINS: ChainCard[] = [
  { name: "Solana", asset: "USDC", detail: "Solana Pay QR or any Solana wallet; bound to the checkout by a reference key." },
  { name: "Ethereum", asset: "USDC", detail: "Any EIP-6963 wallet; 12 confirmations before access is delivered." },
  { name: "Base", asset: "USDC", detail: "Low fees, fast confirmation; agent purchases via x402." },
  { name: "Arbitrum", asset: "USDC", detail: "Native USDC on Arbitrum One." },
  {
    name: "Robinhood Chain",
    asset: "USDG",
    label: "USDG",
    detail: "Settles USDG (Paxos Global Dollar); Robinhood Chain has no native USDC.",
  },
  {
    name: "Hyperliquid",
    asset: "USDC",
    label: "HyperEVM + HyperCore",
    detail: "USDC on HyperEVM, or usdSend straight into your HyperCore account.",
  },
  {
    name: "Tempo",
    asset: "USDC.e",
    label: "Bridged",
    detail: "USDC.e bridged via Stargate, with a per-checkout transfer memo.",
  },
  {
    name: "Zcash",
    asset: "ZEC",
    label: "Transparent",
    detail: "Transparent ZEC at a locked USD quote. Shielded payments are on the roadmap.",
  },
];

export const FOUNDER_STORY = {
  title: "Built because merchants of record said no",
  paragraphs: [
    "We build software products: Menivor for AI video, Scribase for Postgres backends, Rally for go-to-market. When it was time to charge for them, merchant-of-record platforms turned them down. No appeal, and no clear path to getting paid.",
    "Stablecoins fixed that. A buyer anywhere can pay in digital dollars on the chain they already use, and the money lands in our own wallet. What was missing was everything around the payment: a checkout that works on every chain, verification we can trust, and access that is delivered the moment the payment settles.",
    "SettleKit is that missing part, opened up for every founder, small team, app studio and software seller in the same position.",
  ],
} as const;

export const HOW_IT_WORKS = [
  {
    title: "Share one link",
    description: "Create a product, set a USD price, and share its checkout link or drop the pay button on your site.",
  },
  {
    title: "Buyer pays with any token",
    description:
      "They pick a chain and pay in stablecoins, or pay with whatever token they hold: Relay and LI.FI route it into your stablecoin.",
  },
  {
    title: "You receive stablecoins",
    description:
      "Funds land directly in your wallet on the network you accept. Every payment is verified on-chain before anything is delivered.",
  },
  {
    title: "Access is delivered",
    description:
      "GitHub repo invite, license key, file download, Discord role or an entitlement your app checks, granted automatically.",
  },
] as const;

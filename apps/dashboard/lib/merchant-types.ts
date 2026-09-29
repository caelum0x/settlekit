// Types + constants for the merchant workspace (/v1/merchant/*). Client-safe:
// no server-only imports, so forms and server pages share them.

export type Network =
  | "solana"
  | "base"
  | "ethereum"
  | "arbitrum"
  | "robinhood"
  | "hyperevm"
  | "hypercore"
  | "tempo"
  | "zcash";

export type AddressGroup = "evm" | "solana" | "hypercore" | "zcash";

export interface NetworkRow {
  network: Network;
  name: string;
  asset: string;
  env: "mainnet" | "testnet";
  enabled: boolean;
  addressGroup: AddressGroup;
  note?: string;
  accepted?: boolean;
  payTo?: string | null;
}

export interface MerchantAddresses {
  evm?: string;
  solana?: string;
  hypercore?: string;
  zcash?: string;
}

export interface MerchantProfile {
  organizationId: string;
  orgName: string;
  supportEmail: string;
  acceptedNetworks: Network[];
  payToByNetwork: Partial<Record<Network, string>>;
  addresses: MerchantAddresses;
  onboarded: boolean;
  testAccount: boolean;
}

export interface ProfileResponse {
  profile: MerchantProfile;
  networks: NetworkRow[];
}

export type DeliveryKind = "github_repo" | "license_key" | "file" | "discord_role" | "access";

export type DeliveryInput =
  | { kind: "github_repo"; repo: string }
  | { kind: "license_key"; machineLimit: number }
  | { kind: "file"; fileUrl: string }
  | { kind: "discord_role"; guildId: string; roleId: string }
  | { kind: "access"; accessUrl?: string };

export interface MerchantProduct {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  priceUsd: string | null;
  priceId: string | null;
  interval: "one_time" | "monthly" | "yearly" | null;
  deliveryKind: DeliveryKind | "other";
  delivery: Record<string, unknown>;
  acceptedNetworks: Network[] | null;
  slug: string | null;
  createdAt: string;
}

export type PaymentSource = "checkout" | "agent_x402" | "agent_mpp" | "direct";

export interface PaymentView {
  id: string;
  status: "pending" | "confirmed" | "failed" | "refunded";
  network: Network | "arc";
  networkName: string;
  env: "mainnet" | "testnet";
  asset: string;
  amountUsd: string;
  settled?: { amount: string; asset: string };
  txHash: string | null;
  explorerUrl: string | null;
  source: PaymentSource;
  createdAt: string;
  confirmedAt: string | null;
  buyer: {
    customerId: string;
    email: string | null;
    githubUsername: string | null;
    discordUserId: string | null;
    wallet: string | null;
  };
  products: { id: string; name: string }[];
  routedFrom: {
    provider: string;
    originChainId: number;
    originToken: string;
    originTxHash: string | null;
    state: string;
  } | null;
}

export interface TimelineStep {
  key: "created" | "paid" | "verified" | "delivered" | "refunded";
  label: string;
  at: string | null;
  done: boolean;
  detail?: string;
}

export interface PaymentDetail extends PaymentView {
  sessionId: string | null;
  timeline: TimelineStep[];
  entitlements: {
    id: string;
    productId: string;
    entitlementType: string;
    status: string;
    createdAt: string;
  }[];
  deliveryRuns: { id: string; status: string; createdAt: string; completedAt?: string }[];
  refunds: {
    id: string;
    amount: { amount: string; currency: string };
    reason: string;
    status: string;
    txHash?: string;
    explorerUrl?: string | null;
    createdAt: string;
  }[];
}

export interface CustomerView {
  id: string;
  email: string | null;
  githubUsername: string | null;
  discordUserId: string | null;
  wallet: string | null;
  payments: number;
  spentUsd: string;
  firstSeen: string;
  lastPaid: string | null;
  networks: string[];
  entitlements: {
    id: string;
    productId: string;
    entitlementType: string;
    status: string;
    createdAt: string;
    expiresAt?: string;
  }[];
}

export interface NetworkBalance {
  network: Network;
  address: string;
  asset: string;
  balance: string | null;
  env: "mainnet" | "testnet";
  error?: string;
  addressUrl: string | null;
}

export interface MerchantOverview {
  onboarded: boolean;
  acceptedNetworks: Network[];
  productCount: number;
  firstProduct: MerchantProduct | null;
  paymentCount: number;
  volumeUsd: string;
  byNetwork: Record<string, { count: number; volumeUsd: number }>;
}

/** Result of a server action: data or a user-facing error (+ field errors). */
export interface ActionResult<T> {
  data: T | null;
  error: string | null;
  fields?: Record<string, string>;
}

export const DELIVERY_OPTIONS: { kind: DeliveryKind; title: string; desc: string }[] = [
  { kind: "github_repo", title: "GitHub repo", desc: "Buyer is invited to a private repository." },
  { kind: "license_key", title: "License key", desc: "A unique key is issued on payment." },
  { kind: "file", title: "File download", desc: "A download link revealed after payment." },
  { kind: "discord_role", title: "Discord role", desc: "Buyer gets a role in your server." },
  { kind: "access", title: "Plain access", desc: "An entitlement your app checks via the API." },
];

export const GROUP_LABELS: Record<AddressGroup, { title: string; placeholder: string; help: string }> = {
  evm: {
    title: "EVM address",
    placeholder: "0x...",
    help: "One address for Ethereum, Base, Arbitrum, Robinhood Chain, HyperEVM and Tempo.",
  },
  solana: { title: "Solana address", placeholder: "Your Solana wallet address", help: "USDC arrives in this wallet." },
  hypercore: {
    title: "Hyperliquid address",
    placeholder: "0x... (defaults to your EVM address)",
    help: "Your Hyperliquid account; buyers pay with usdSend.",
  },
  zcash: {
    title: "Zcash transparent address",
    placeholder: "t1... or t3...",
    help: "Transparent only for now; shielded addresses are not supported yet.",
  },
};

/** Instant, lightweight format hints; the API validates authoritatively per chain. */
export function addressHint(group: AddressGroup, value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  switch (group) {
    case "evm":
    case "hypercore":
      return /^0x[0-9a-fA-F]{40}$/.test(v) ? null : "Should be 0x followed by 40 hex characters.";
    case "solana":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? null : "Should be a base58 Solana address (32-44 characters).";
    case "zcash":
      if (/^(u1|zs)/.test(v)) return "Shielded addresses are not supported yet; use a transparent t-address.";
      return /^t[13m2][1-9A-HJ-NP-Za-km-z]{33}$/.test(v) ? null : "Should be a transparent address starting with t1 or t3.";
  }
}

export function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortHash(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

export const SOURCE_LABEL: Record<PaymentSource, string> = {
  checkout: "Checkout",
  agent_x402: "AI agent (x402)",
  agent_mpp: "AI agent (MPP)",
  direct: "Direct transfer",
};

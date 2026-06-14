export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Default settlement wallet for payouts (Arc / EVM address). */
  payoutWalletAddress?: string;
  createdAt: string;
}

export type UserRole = "owner" | "admin" | "member";

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface Merchant {
  id: string;
  organizationId: string;
  displayName: string;
  /** Public marketplace slug. */
  slug: string;
  supportEmail?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  organizationId: string;
  email: string;
  name?: string;
  /** Buyer's wallet address used for payment / refunds. */
  walletAddress?: string;
  /** External identity hooks used by delivery actions. */
  githubUsername?: string;
  discordUserId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PayoutWallet {
  id: string;
  organizationId: string;
  address: string;
  network: "arc" | "base" | "ethereum";
  label?: string;
  isDefault: boolean;
  createdAt: string;
}

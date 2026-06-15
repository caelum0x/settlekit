export type CustomerStatus = "active" | "past_due" | "blocked" | "archived";

export interface CustomerIdentity {
  email?: string;
  walletAddress?: string;
  githubUsername?: string;
  discordUserId?: string;
}

export interface CustomerProfile {
  id: string;
  organizationId: string;
  name?: string;
  identity: CustomerIdentity;
  status: CustomerStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSegmentRule {
  status?: CustomerStatus;
  tag?: string;
  hasWallet?: boolean;
}

export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function customerMatchesSegment(customer: CustomerProfile, rule: CustomerSegmentRule): boolean {
  if (rule.status && customer.status !== rule.status) {
    return false;
  }

  if (rule.tag && !customer.tags.includes(rule.tag)) {
    return false;
  }

  if (rule.hasWallet !== undefined && Boolean(customer.identity.walletAddress) !== rule.hasWallet) {
    return false;
  }

  return true;
}

export function mergeCustomerProfiles(
  primary: CustomerProfile,
  duplicate: CustomerProfile,
): CustomerProfile {
  return {
    ...primary,
    name: primary.name ?? duplicate.name,
    identity: {
      email: primary.identity.email ?? duplicate.identity.email,
      walletAddress: primary.identity.walletAddress ?? duplicate.identity.walletAddress,
      githubUsername: primary.identity.githubUsername ?? duplicate.identity.githubUsername,
      discordUserId: primary.identity.discordUserId ?? duplicate.identity.discordUserId,
    },
    tags: Array.from(new Set([...primary.tags, ...duplicate.tags])).sort(),
    updatedAt: duplicate.updatedAt > primary.updatedAt ? duplicate.updatedAt : primary.updatedAt,
  };
}

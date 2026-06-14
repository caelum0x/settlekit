import { randomUUID, randomBytes } from "node:crypto";

/**
 * Stripe-style prefixed identifiers. Each resource gets a stable, human-readable
 * prefix so IDs are self-describing in logs, webhooks, and dashboards.
 */
export const ID_PREFIXES = {
  organization: "org",
  user: "user",
  merchant: "mch",
  customer: "cus",
  product: "prod",
  price: "price",
  bundle: "bndl",
  checkoutSession: "cs",
  payment: "pay",
  subscription: "sub",
  usageMeter: "meter",
  creditBalance: "cb",
  entitlement: "ent",
  deliveryPlan: "dplan",
  deliveryRun: "drun",
  deliveryAction: "dact",
  licenseKey: "lic",
  apiKey: "ak",
  githubInstallation: "ghi",
  githubRepoAccess: "ghra",
  discordRoleAccess: "dra",
  fileAsset: "file",
  webhookEndpoint: "we",
  webhookEvent: "evt",
  marketplaceListing: "ml",
  agentService: "ags",
  escrowTask: "esc",
  payoutWallet: "pw",
  riskProfile: "risk",
} as const;

export type ResourceName = keyof typeof ID_PREFIXES;

/** Generate a unique, prefixed identifier for the given resource. */
export function generateId(resource: ResourceName): string {
  const prefix = ID_PREFIXES[resource];
  // 24 hex chars of entropy keeps collisions negligible while staying compact.
  const suffix = randomBytes(12).toString("hex");
  return `${prefix}_${suffix}`;
}

/** Returns true if `id` is a well-formed identifier for `resource`. */
export function isId(resource: ResourceName, id: string): boolean {
  return id.startsWith(`${ID_PREFIXES[resource]}_`) && id.length > ID_PREFIXES[resource].length + 1;
}

/** A random UUID v4, used where an opaque correlation token is needed. */
export function uuid(): string {
  return randomUUID();
}

/**
 * Generate a high-entropy secret token (e.g. for API keys / license keys).
 * Returned as URL-safe base64 without padding.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

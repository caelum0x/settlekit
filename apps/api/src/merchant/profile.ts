/**
 * The merchant's payment profile: which networks they accept and the address
 * that receives funds on each. Stored on the organization's settings so every
 * checkout session (API, payment links, dashboard) uses the same destinations.
 *
 * Merchants paste one address per address group — one EVM address serves
 * Ethereum, Base, Arbitrum, Robinhood Chain, HyperEVM and Tempo — and every
 * address is validated for its chain before it is saved (funds sent to a
 * malformed address are unrecoverable).
 */
import { z } from "zod";
import { isPaymentNetwork, validationError, type PaymentNetwork } from "@settlekit/common";
import { checkPayTo } from "@settlekit/chains";
import type { OrgSettings } from "@settlekit/persistence";
import { merchants } from "@settlekit/database";
import type { AppContext } from "../context.js";
import { MERCHANT_NETWORKS, networkCatalog, apiConfig, type AddressGroup } from "./network-catalog.js";
import { merchantIdFor } from "./products.js";

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
  acceptedNetworks: PaymentNetwork[];
  payToByNetwork: Partial<Record<PaymentNetwork, string>>;
  addresses: MerchantAddresses;
  onboarded: boolean;
  testAccount: boolean;
}

const networkEnum = z.enum(MERCHANT_NETWORKS as unknown as [PaymentNetwork, ...PaymentNetwork[]]);

export const profileInputSchema = z.object({
  orgName: z.string().trim().min(1).max(120).optional(),
  supportEmail: z.string().trim().email().or(z.literal("")).optional(),
  acceptedNetworks: z.array(networkEnum).min(1, "choose at least one network"),
  addresses: z.object({
    evm: z.string().trim().optional(),
    solana: z.string().trim().optional(),
    hypercore: z.string().trim().optional(),
    zcash: z.string().trim().optional(),
  }),
  testAccount: z.boolean().optional(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

const GROUP_LABEL: Record<AddressGroup, string> = {
  evm: "EVM address (0x...)",
  solana: "Solana address",
  hypercore: "Hyperliquid address (0x...)",
  zcash: "Zcash transparent address (t1... / t3...)",
};

function groupOf(network: PaymentNetwork): AddressGroup {
  if (network === "solana" || network === "hypercore" || network === "zcash") return network;
  return "evm";
}

/** Read a merchant's profile from their org settings. */
export function profileFromSettings(organizationId: string, settings: OrgSettings): MerchantProfile {
  const accepted = (settings.acceptedNetworks ?? []).filter(
    (n): n is PaymentNetwork => isPaymentNetwork(n) && MERCHANT_NETWORKS.includes(n),
  );
  const payTo: Partial<Record<PaymentNetwork, string>> = {};
  for (const [network, address] of Object.entries(settings.payToByNetwork ?? {})) {
    if (isPaymentNetwork(network) && typeof address === "string" && address.length > 0) payTo[network] = address;
  }
  const addresses: MerchantAddresses = {};
  for (const network of MERCHANT_NETWORKS) {
    const address = payTo[network];
    if (address !== undefined) addresses[groupOf(network)] ??= address;
  }
  return {
    organizationId,
    orgName: settings.orgName,
    supportEmail: settings.supportEmail,
    acceptedNetworks: accepted,
    payToByNetwork: payTo,
    addresses,
    onboarded: accepted.length > 0 && accepted.every((n) => payTo[n] !== undefined),
    testAccount: settings.testAccount === true,
  };
}

export async function loadProfile(ctx: AppContext, organizationId: string): Promise<MerchantProfile> {
  return profileFromSettings(organizationId, await ctx.orgSettings.get(organizationId));
}

/**
 * Validate the pasted addresses for every accepted network and derive the
 * per-network payTo map. Throws a validation error naming each bad field.
 */
export function resolvePayTo(input: ProfileInput): Partial<Record<PaymentNetwork, string>> {
  const zcashNetwork = apiConfig().zcash?.network ?? "mainnet";
  const problems: Record<string, string> = {};
  const payTo: Partial<Record<PaymentNetwork, string>> = {};
  for (const network of new Set(input.acceptedNetworks)) {
    const group = groupOf(network);
    // HyperCore accounts are 0x addresses; default to the EVM address.
    const address = group === "hypercore" ? input.addresses.hypercore || input.addresses.evm : input.addresses[group];
    if (!address) {
      problems[group] = `${GROUP_LABEL[group]} is required to accept ${network}`;
      continue;
    }
    const check = checkPayTo(network, address, { zcashNetwork });
    if (!check.ok) {
      problems[group] = `${GROUP_LABEL[group]}: ${check.reason}`;
      continue;
    }
    payTo[network] = address;
  }
  if (Object.keys(problems).length > 0) {
    throw validationError("Some receiving addresses are missing or invalid", { fields: problems });
  }
  return payTo;
}

/** Validate + persist a merchant's networks and addresses. */
export async function saveProfile(ctx: AppContext, organizationId: string, input: ProfileInput): Promise<MerchantProfile> {
  const payToByNetwork = resolvePayTo(input);
  const acceptedNetworks = MERCHANT_NETWORKS.filter((n) => payToByNetwork[n] !== undefined);
  const current = await ctx.orgSettings.get(organizationId);
  const settings = await ctx.orgSettings.update(organizationId, {
    ...(input.orgName !== undefined ? { orgName: input.orgName } : {}),
    ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail } : {}),
    ...(input.testAccount !== undefined ? { testAccount: input.testAccount } : {}),
    acceptedNetworks,
    payToByNetwork: payToByNetwork as Record<string, string>,
    onboardedAt: current.onboardedAt ?? new Date().toISOString(),
  });
  await ensureMerchantRow(ctx, organizationId, settings.orgName, settings.supportEmail);
  return profileFromSettings(organizationId, settings);
}

/** Catalog rows plus whether the merchant accepts each network. */
export function networksForProfile(profile: MerchantProfile) {
  return networkCatalog().map((row) => ({
    ...row,
    accepted: profile.acceptedNetworks.includes(row.network),
    payTo: profile.payToByNetwork[row.network] ?? null,
  }));
}

/**
 * Postgres: keep a merchants row for the org so the hosted checkout shows the
 * seller's name (the org row itself is created by the settings store).
 */
async function ensureMerchantRow(ctx: AppContext, organizationId: string, displayName: string, supportEmail: string): Promise<void> {
  if (!ctx.db) return;
  const values = { displayName, supportEmail: supportEmail || null };
  await ctx.db
    .insert(merchants)
    .values({ id: merchantIdFor(organizationId), organizationId, defaultCurrency: "USDC", status: "active", metadata: {}, ...values })
    .onConflictDoUpdate({ target: merchants.id, set: values });
}

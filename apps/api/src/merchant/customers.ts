/**
 * Merchant customer list: everyone who paid (from payments + the checkout
 * fields they filled in) merged with explicitly created customers, each with
 * lifetime spend and the entitlements (access) they hold.
 */
import type { Entitlement } from "@settlekit/common";
import type { AppContext } from "../context.js";
import { buildPaymentViews } from "./payment-views.js";

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
  entitlements: Pick<Entitlement, "id" | "productId" | "entitlementType" | "status" | "createdAt" | "expiresAt">[];
}

function addUsd(a: string, b: string): string {
  const cents = (v: string): bigint => {
    const [w = "0", f = ""] = v.split(".");
    return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2));
  };
  const t = cents(a) + cents(b);
  return `${t / 100n}.${(t % 100n).toString().padStart(2, "0")}`;
}

export async function listCustomers(ctx: AppContext, organizationId: string): Promise<CustomerView[]> {
  const payments = await ctx.payments.listByOrganization(organizationId);
  const views = await buildPaymentViews(ctx, payments);
  const stored = await ctx.customers.list((c) => c.organizationId === organizationId);
  const byId = new Map<string, CustomerView>();

  for (const c of stored) {
    byId.set(c.id, {
      id: c.id,
      email: c.email || null,
      githubUsername: c.githubUsername ?? null,
      discordUserId: c.discordUserId ?? null,
      wallet: c.walletAddress ?? null,
      payments: 0,
      spentUsd: "0.00",
      firstSeen: c.createdAt,
      lastPaid: null,
      networks: [],
      entitlements: [],
    });
  }
  for (const v of views) {
    const prev = byId.get(v.buyer.customerId);
    const paid = v.status === "confirmed";
    const next: CustomerView = {
      id: v.buyer.customerId,
      email: prev?.email ?? v.buyer.email,
      githubUsername: prev?.githubUsername ?? v.buyer.githubUsername,
      discordUserId: prev?.discordUserId ?? v.buyer.discordUserId,
      wallet: prev?.wallet ?? v.buyer.wallet,
      payments: (prev?.payments ?? 0) + (paid ? 1 : 0),
      spentUsd: paid ? addUsd(prev?.spentUsd ?? "0.00", v.amountUsd) : prev?.spentUsd ?? "0.00",
      firstSeen: prev && prev.firstSeen < v.createdAt ? prev.firstSeen : v.createdAt,
      lastPaid:
        paid && (!prev?.lastPaid || (v.confirmedAt ?? v.createdAt) > prev.lastPaid)
          ? v.confirmedAt ?? v.createdAt
          : prev?.lastPaid ?? null,
      networks: [...new Set([...(prev?.networks ?? []), v.networkName])],
      entitlements: [],
    };
    byId.set(next.id, next);
  }

  const withAccess = await Promise.all(
    [...byId.values()].map(async (c) => {
      const ents = (await ctx.entitlementRepo.listByCustomer(c.id)).filter((e) => e.organizationId === organizationId);
      return {
        ...c,
        entitlements: ents.map(({ id, productId, entitlementType, status, createdAt, expiresAt }) => ({
          id,
          productId,
          entitlementType,
          status,
          createdAt,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        })),
      };
    }),
  );
  return withAccess
    .filter((c) => c.payments > 0 || c.entitlements.length > 0 || stored.some((s) => s.id === c.id))
    .sort((a, b) => (b.lastPaid ?? b.firstSeen).localeCompare(a.lastPaid ?? a.firstSeen));
}

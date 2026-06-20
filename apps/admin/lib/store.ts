import { RuleEngine } from "@settlekit/risk";
import type {
  AdminDeliveryRun,
  AdminOrganization,
  AdminPayment,
  AdminEntitlement,
  AdminRiskProfile,
  AdminSettlement,
  AdminWebhookEvent,
} from "./types";
import {
  seedDeliveryRuns,
  seedEntitlements,
  seedOrganizations,
  seedPayments,
  seedRiskProfiles,
  seedSettlements,
  seedWebhookEvents,
} from "./seed";

/**
 * Process-wide store for the admin console. When no DATABASE_URL is set the
 * store is backed by the deterministic seed (see seed.ts); mutations performed
 * by the action routes (retry / replay / risk decisions) persist for the life
 * of the server process. All mutation methods follow the immutable update rule:
 * the stored array entry is REPLACED with a new object, never mutated in place.
 *
 * The store is a module singleton, cached on globalThis so Next.js HMR in dev
 * does not reset state on every request.
 */
export interface AdminStore {
  readonly engine: RuleEngine;
  organizations: AdminOrganization[];
  payments: AdminPayment[];
  entitlements: AdminEntitlement[];
  deliveryRuns: AdminDeliveryRun[];
  webhookEvents: AdminWebhookEvent[];
  riskProfiles: AdminRiskProfile[];
  settlements: AdminSettlement[];
}

const GLOBAL_KEY = "__settlekit_admin_store__";

function createStore(): AdminStore {
  return {
    engine: new RuleEngine(),
    // Shallow-clone the seed arrays so the seed module stays pristine.
    organizations: [...seedOrganizations],
    payments: [...seedPayments],
    entitlements: [...seedEntitlements],
    deliveryRuns: [...seedDeliveryRuns],
    webhookEvents: [...seedWebhookEvents],
    riskProfiles: [...seedRiskProfiles],
    settlements: [...seedSettlements],
  };
}

export function getStore(): AdminStore {
  const g = globalThis as unknown as Record<string, AdminStore | undefined>;
  let store = g[GLOBAL_KEY];
  if (!store) {
    store = createStore();
    g[GLOBAL_KEY] = store;
  }
  return store;
}

/** Replace the entry with id `id` in `list` using `next`, returning a new array. */
export function replaceById<T extends { id: string }>(
  list: T[],
  id: string,
  next: (current: T) => T,
): { list: T[]; updated: T | null } {
  let updated: T | null = null;
  const out = list.map((item) => {
    if (item.id !== id) return item;
    updated = next(item);
    return updated;
  });
  return { list: out, updated };
}

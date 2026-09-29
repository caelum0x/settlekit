/**
 * Tenant scoping helper.
 *
 * The auth middleware binds the authenticated API key's `organizationId` onto
 * the request. `requireOrg` reads it so route handlers scope every read/write
 * to the caller's tenant instead of trusting a client-supplied `organizationId`
 * or falling back to the shared platform default.
 *
 * Falls back to {@link DEFAULT_ORG_ID} only for the bootstrap key (dev/admin),
 * which the middleware binds explicitly.
 */
import type { Context } from "hono";
import { notFound, type Payment, type Subscription } from "@settlekit/common";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";

/** The organization the current request is authenticated for. */
export function requireOrg(c: Context<AppEnv>): string {
  return c.get("organizationId") ?? DEFAULT_ORG_ID;
}

/** Anything stamped with the tenant that owns it. */
export interface TenantOwned {
  readonly organizationId: string;
}

/**
 * Ownership guard for single-resource routes that load a record by an opaque
 * id. Returns the record when it belongs to the authenticated org; otherwise
 * throws `not_found` — deliberately 404, never 403, so a caller cannot probe
 * which ids exist in other tenants.
 */
export function requireOwned<T extends TenantOwned>(
  c: Context<AppEnv>,
  resource: T | null | undefined,
  label: string,
  id: string,
): T {
  if (!resource || resource.organizationId !== requireOrg(c)) {
    throw notFound(`${label} not found`, { id });
  }
  return resource;
}

/** Whether `resource` belongs to the authenticated org (no throw). */
export function isOwned(c: Context<AppEnv>, resource: TenantOwned | null | undefined): boolean {
  return resource !== null && resource !== undefined && resource.organizationId === requireOrg(c);
}

/**
 * Load a payment by id and require it belongs to the caller's org. Used by the
 * payment routes and by resources that hang off a payment (refunds, disputes).
 */
export async function requireOwnedPayment(c: Context<AppEnv>, paymentId: string): Promise<Payment> {
  return requireOwned(c, await c.get("ctx").payments.findById(paymentId), "payment", paymentId);
}

/** Load a subscription by id, requiring it belongs to the caller's org. */
export async function ownedSubscription(c: Context<AppEnv>, subscriptionId: string): Promise<Subscription> {
  return requireOwned(c, await c.get("ctx").subscriptions.findById(subscriptionId), "subscription", subscriptionId);
}

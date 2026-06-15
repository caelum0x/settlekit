/**
 * Shared fixtures for delivery tests: a deterministic clock, an in-memory
 * logger, a builder for the run context, and a sample multi-action plan.
 */

import { generateId, toIso } from "@settlekit/common";
import type { DeliveryAction, DeliveryLog, DeliveryPlan } from "@settlekit/common";
import type { DeliveryContext, DeliveryLogger } from "../src/index.js";
import type { DeliveryClients } from "../src/index.js";

/** Logger that captures every emitted entry for assertions. */
export class RecordingLogger implements DeliveryLogger {
  readonly entries: DeliveryLog[] = [];
  log(entry: DeliveryLog): void {
    this.entries.push(entry);
  }
}

/** A no-op sleep so backoff never slows the suite. */
export const instantSleep = async (_ms: number): Promise<void> => {};

/** Fixed clock for deterministic timestamps. */
export const fixedNow = (): Date => new Date("2026-06-15T00:00:00.000Z");

export function buildContext(clients: DeliveryClients): DeliveryContext {
  return {
    organizationId: generateId("organization"),
    customerId: generateId("customer"),
    productId: generateId("product"),
    paymentId: generateId("payment"),
    entitlementId: generateId("entitlement"),
    githubInstallationId: 42,
    githubUsername: "octocat",
    discordUserId: "discord-user-1",
    customerEmail: "buyer@example.com",
    emailVariables: { plan: "pro" },
    clients,
  };
}

/** A plan exercising several distinct action types in order. */
export function buildPlan(organizationId: string, actions?: DeliveryAction[]): DeliveryPlan {
  return {
    id: generateId("deliveryPlan"),
    organizationId,
    productId: generateId("product"),
    actions:
      actions ?? [
        { type: "github_invite", repoId: "settlekit/private-repo", permission: "push" },
        { type: "license_key_create", policyId: "policy-standard" },
        { type: "saas_entitlement_create", features: { seats: 5, sso: true } },
        { type: "email_send", template: "purchase-receipt" },
      ],
    createdAt: toIso(fixedNow()),
  };
}

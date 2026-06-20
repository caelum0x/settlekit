import { money } from "@settlekit/common";
import { RuleEngine, type RiskContext } from "@settlekit/risk";
import type {
  AdminDeliveryRun,
  AdminEntitlement,
  AdminOrganization,
  AdminPayment,
  AdminRiskProfile,
  AdminSettlement,
  AdminWebhookEvent,
} from "./types";

/**
 * Deterministic seed used when no DATABASE_URL is configured. Timestamps are
 * derived from a fixed epoch so renders are stable across reloads. The risk
 * profiles below are scored by the real @settlekit/risk RuleEngine — the score,
 * flags and decision are NOT hardcoded, they are computed from contexts.
 */

const BASE = Date.parse("2026-06-01T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (offsetMs: number): string => new Date(BASE + offsetMs).toISOString();

export const seedOrganizations: AdminOrganization[] = [
  { id: "org_acme", name: "Acme Tools", slug: "acme-tools", status: "active", createdAt: iso(0) },
  { id: "org_globex", name: "Globex SaaS", slug: "globex", status: "active", createdAt: iso(DAY) },
  { id: "org_initech", name: "Initech APIs", slug: "initech", status: "active", createdAt: iso(2 * DAY) },
  { id: "org_umbrella", name: "Umbrella Agents", slug: "umbrella", status: "suspended", createdAt: iso(3 * DAY) },
];

export const seedPayments: AdminPayment[] = [
  { id: "pay_1001", organizationId: "org_acme", customerId: "cus_a1", status: "confirmed", amount: money("129.00"), network: "base", createdAt: iso(5 * HOUR) },
  { id: "pay_1002", organizationId: "org_acme", customerId: "cus_a2", status: "confirmed", amount: money("49.00"), network: "base", createdAt: iso(9 * HOUR) },
  { id: "pay_1003", organizationId: "org_globex", customerId: "cus_g1", status: "confirmed", amount: money("999.00"), network: "arbitrum", createdAt: iso(DAY + 2 * HOUR) },
  { id: "pay_1004", organizationId: "org_globex", customerId: "cus_g2", status: "failed", amount: money("999.00"), network: "arbitrum", createdAt: iso(DAY + 4 * HOUR) },
  { id: "pay_1005", organizationId: "org_initech", customerId: "cus_i1", status: "confirmed", amount: money("2500.00"), network: "base", createdAt: iso(2 * DAY + HOUR) },
  { id: "pay_1006", organizationId: "org_umbrella", customerId: "cus_u1", status: "refunded", amount: money("750.00"), network: "polygon", createdAt: iso(3 * DAY + 3 * HOUR) },
  { id: "pay_1007", organizationId: "org_acme", customerId: "cus_a3", status: "pending", amount: money("19.00"), network: "base", createdAt: iso(4 * DAY) },
];

export const seedEntitlements: AdminEntitlement[] = [
  { id: "ent_1", organizationId: "org_acme", customerId: "cus_a1", type: "github_repo", status: "active", createdAt: iso(5 * HOUR) },
  { id: "ent_2", organizationId: "org_acme", customerId: "cus_a2", type: "license_key", status: "active", createdAt: iso(9 * HOUR) },
  { id: "ent_3", organizationId: "org_globex", customerId: "cus_g1", type: "saas_seat", status: "active", createdAt: iso(DAY + 2 * HOUR) },
  { id: "ent_4", organizationId: "org_initech", customerId: "cus_i1", type: "api_key", status: "active", createdAt: iso(2 * DAY + HOUR) },
  { id: "ent_5", organizationId: "org_umbrella", customerId: "cus_u1", type: "agent_tool", status: "revoked", createdAt: iso(3 * DAY + 3 * HOUR) },
  { id: "ent_6", organizationId: "org_globex", customerId: "cus_g3", type: "saas_seat", status: "expired", createdAt: iso(DAY) },
];

export const seedDeliveryRuns: AdminDeliveryRun[] = [
  {
    id: "drun_1", organizationId: "org_acme", paymentId: "pay_1001", entitlementId: "ent_1",
    status: "succeeded", attempt: 1,
    actionRuns: [{ actionId: "grant_github", status: "succeeded" }],
    createdAt: iso(5 * HOUR), updatedAt: iso(5 * HOUR + 60_000),
  },
  {
    id: "drun_2", organizationId: "org_globex", paymentId: "pay_1003", entitlementId: "ent_3",
    status: "failed", attempt: 3,
    actionRuns: [
      { actionId: "create_seat", status: "succeeded" },
      { actionId: "send_invite", status: "failed", error: "SMTP 550 mailbox unavailable" },
    ],
    lastError: "SMTP 550 mailbox unavailable",
    createdAt: iso(DAY + 2 * HOUR), updatedAt: iso(DAY + 2 * HOUR + 5 * 60_000),
  },
  {
    id: "drun_3", organizationId: "org_initech", paymentId: "pay_1005", entitlementId: "ent_4",
    status: "failed", attempt: 2,
    actionRuns: [{ actionId: "provision_api_key", status: "failed", error: "upstream 503 from key service" }],
    lastError: "upstream 503 from key service",
    createdAt: iso(2 * DAY + HOUR), updatedAt: iso(2 * DAY + HOUR + 3 * 60_000),
  },
  {
    id: "drun_4", organizationId: "org_umbrella", paymentId: "pay_1006", entitlementId: "ent_5",
    status: "failed", attempt: 5,
    actionRuns: [{ actionId: "register_agent", status: "failed", error: "rate limited (429)" }],
    lastError: "rate limited (429)",
    createdAt: iso(3 * DAY + 3 * HOUR), updatedAt: iso(3 * DAY + 3 * HOUR + 10 * 60_000),
  },
];

export const seedWebhookEvents: AdminWebhookEvent[] = [
  {
    id: "whk_1", organizationId: "org_acme", type: "payment.confirmed",
    endpointUrl: "https://acme.example.com/hooks/settlekit",
    payload: { paymentId: "pay_1001", amount: "129.00" },
    delivered: true, attempts: 1, createdAt: iso(5 * HOUR), deliveredAt: iso(5 * HOUR + 2_000),
  },
  {
    id: "whk_2", organizationId: "org_globex", type: "entitlement.granted",
    endpointUrl: "https://globex.example.com/webhooks",
    payload: { entitlementId: "ent_3", type: "saas_seat" },
    delivered: false, attempts: 4, lastError: "connect ETIMEDOUT", createdAt: iso(DAY + 2 * HOUR),
  },
  {
    id: "whk_3", organizationId: "org_initech", type: "payment.confirmed",
    endpointUrl: "https://initech.example.com/sk-hook",
    payload: { paymentId: "pay_1005", amount: "2500.00" },
    delivered: false, attempts: 6, lastError: "HTTP 500 from endpoint", createdAt: iso(2 * DAY + HOUR),
  },
  {
    id: "whk_4", organizationId: "org_umbrella", type: "delivery.failed",
    endpointUrl: "https://umbrella.example.com/in",
    payload: { deliveryRunId: "drun_4", error: "rate limited (429)" },
    delivered: false, attempts: 2, lastError: "HTTP 401 unauthorized", createdAt: iso(3 * DAY + 3 * HOUR),
  },
];

export const seedSettlements: AdminSettlement[] = [
  {
    id: "po_2001", organizationId: "org_acme", status: "settled",
    amount: money("129.00"), network: "base", reference: "stl_po_2001",
    txHash: "0x9f1a3c7e2b4d6f8a0c1e2d3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f",
    createdAt: iso(6 * HOUR), updatedAt: iso(6 * HOUR + 12 * 60_000),
  },
  {
    id: "po_2002", organizationId: "org_globex", status: "settled",
    amount: money("999.00"), network: "arbitrum", reference: "stl_po_2002",
    txHash: "0x1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff001",
    createdAt: iso(DAY + 3 * HOUR), updatedAt: iso(DAY + 3 * HOUR + 9 * 60_000),
  },
  {
    id: "po_2003", organizationId: "org_initech", status: "submitted",
    amount: money("2500.00"), network: "arc", reference: "stl_po_2003",
    txHash: "0xaabb00ff11223344556677889900aabbccddeeff00112233445566778899aabb",
    createdAt: iso(2 * DAY + 2 * HOUR), updatedAt: iso(2 * DAY + 2 * HOUR + 90_000),
  },
  {
    id: "po_2004", organizationId: "org_acme", status: "pending",
    amount: money("49.00"), network: "base", reference: "stl_po_2004",
    createdAt: iso(4 * DAY), updatedAt: iso(4 * DAY),
  },
  {
    id: "po_2005", organizationId: "org_umbrella", status: "failed",
    amount: money("750.00"), network: "polygon", reference: "stl_po_2005",
    createdAt: iso(3 * DAY + 4 * HOUR), updatedAt: iso(3 * DAY + 4 * HOUR + 6 * 60_000),
  },
];

/**
 * Build risk profiles by running real contexts through the @settlekit/risk
 * RuleEngine, so score/flags/decision are derived, not invented.
 */
function buildRiskProfiles(): AdminRiskProfile[] {
  const engine = new RuleEngine();
  const now = BASE + 4 * DAY;

  const contexts: Array<{ customerId: string; ctx: RiskContext }> = [
    {
      customerId: "cus_a1",
      ctx: {
        organizationId: "org_acme", customerId: "cus_a1", now, amount: money("129.00"),
        accountCreatedAt: BASE - 200 * DAY, chargebackCount: 0,
      },
    },
    {
      customerId: "cus_g2",
      ctx: {
        organizationId: "org_globex", customerId: "cus_g2", now, amount: money("999.00"),
        accountCreatedAt: now - HOUR,
        recentCheckouts: Array.from({ length: 7 }, (_, i) => ({ at: now - i * 5 * 60_000 })),
        billingCountry: "US", ipCountry: "NG",
        walletAddress: "0xabc", walletDistinctCustomerCount: 4,
      },
    },
    {
      customerId: "cus_i1",
      ctx: {
        organizationId: "org_initech", customerId: "cus_i1", now, amount: money("2500.00"),
        accountCreatedAt: now - 2 * HOUR, chargebackCount: 2,
        recentRefunds: Array.from({ length: 4 }, (_, i) => ({ at: now - i * DAY })),
      },
    },
    {
      customerId: "cus_u1",
      ctx: {
        organizationId: "org_umbrella", customerId: "cus_u1", now, amount: money("750.00"),
        accountCreatedAt: BASE - 30 * DAY, chargebackCount: 5,
        billingCountry: "GB", ipCountry: "RU",
        walletAddress: "0xdef", walletDistinctCustomerCount: 9,
      },
    },
  ];

  return contexts.map(({ customerId, ctx }) => {
    const assessment = engine.assess(ctx);
    return {
      id: assessment.profile.id,
      organizationId: assessment.profile.organizationId,
      customerId,
      score: assessment.profile.score,
      flags: assessment.profile.flags,
      decision: assessment.decision,
      reviewState: "open" as const,
      updatedAt: assessment.profile.updatedAt,
    };
  });
}

export const seedRiskProfiles: AdminRiskProfile[] = buildRiskProfiles();

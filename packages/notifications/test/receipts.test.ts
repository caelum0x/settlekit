import { describe, it, expect } from "vitest";
import type { Payment, Merchant, Customer, Entitlement } from "@settlekit/common";
import { money } from "@settlekit/common";
import {
  renderReceiptHtml,
  renderReceiptText,
  sumLineItems,
  renderAccessGrantedEmail,
  renderAccessGrantedText,
  type ReceiptLineItem,
  type AccessInstruction,
} from "../src/index.js";

const merchant: Merchant = {
  id: "merch_1",
  organizationId: "org_1",
  displayName: "Acme Tools",
  slug: "acme-tools",
  supportEmail: "help@acme.dev",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const payment: Payment = {
  id: "pay_abc123",
  organizationId: "org_1",
  checkoutSessionId: "cs_1",
  customerId: "cus_1",
  amount: money("75.5"),
  network: "arc",
  txHash: "0xdeadbeef",
  confirmations: 12,
  status: "confirmed",
  createdAt: "2026-06-10T00:00:00.000Z",
  confirmedAt: "2026-06-10T00:05:00.000Z",
};

const lineItems: ReceiptLineItem[] = [
  { description: "Pro License", quantity: 1, unitPrice: money("50") },
  { description: "Extra Seat", quantity: 1, unitPrice: money("25.5") },
];

describe("sumLineItems", () => {
  it("sums quantity * unitPrice across items", () => {
    const total = sumLineItems([
      { description: "A", quantity: 2, unitPrice: money("10") },
      { description: "B", quantity: 3, unitPrice: money("1.5") },
    ]);
    expect(total.amount).toBe("24.5");
    expect(total.currency).toBe("USDC");
  });

  it("returns zero for empty list", () => {
    expect(sumLineItems([]).amount).toBe("0");
  });
});

describe("renderReceiptHtml", () => {
  const html = renderReceiptHtml(payment, lineItems, merchant);

  it("contains the formatted total amount", () => {
    expect(html).toContain("$75.50 USDC");
  });

  it("contains each line item description and per-line amount", () => {
    expect(html).toContain("Pro License");
    expect(html).toContain("Extra Seat");
    expect(html).toContain("$50.00 USDC");
    expect(html).toContain("$25.50 USDC");
  });

  it("includes payment id, network, status and tx hash", () => {
    expect(html).toContain("pay_abc123");
    expect(html).toContain("arc");
    expect(html).toContain("confirmed");
    expect(html).toContain("0xdeadbeef");
  });

  it("includes merchant branding and support email", () => {
    expect(html).toContain("Acme Tools");
    expect(html).toContain("help@acme.dev");
  });

  it("escapes HTML in merchant display name", () => {
    const evil: Merchant = { ...merchant, displayName: "<script>x</script>" };
    const out = renderReceiptHtml(payment, lineItems, evil);
    expect(out).not.toContain("<script>x</script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("renderReceiptText", () => {
  const text = renderReceiptText(payment, lineItems, merchant);

  it("contains amount and line items in plaintext", () => {
    expect(text).toContain("$75.50 USDC");
    expect(text).toContain("Pro License x 1");
    expect(text).toContain("Extra Seat x 1");
  });
});

describe("renderAccessGrantedEmail", () => {
  const customer: Customer = {
    id: "cus_1",
    organizationId: "org_1",
    email: "buyer@example.com",
    name: "Dana",
    metadata: {},
    createdAt: "2026-06-10T00:00:00.000Z",
  };

  const entA: Entitlement = {
    id: "ent_gh",
    organizationId: "org_1",
    customerId: "cus_1",
    productId: "prod_1",
    grantedBy: { type: "payment", id: "pay_abc123" },
    entitlementType: "github_repo_access",
    status: "active",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  };
  const entB: Entitlement = { ...entA, id: "ent_lic", entitlementType: "license_key" };
  const entC: Entitlement = { ...entA, id: "ent_file", entitlementType: "file_access" };
  const entD: Entitlement = { ...entA, id: "ent_disc", entitlementType: "discord_role" };
  const entE: Entitlement = { ...entA, id: "ent_api", entitlementType: "api_access" };

  const instr: Record<string, AccessInstruction> = {
    gh: {
      entitlementType: "github_repo_access",
      title: "GitHub repository access",
      description: "You were invited to acme/pro-repo.",
      url: "https://github.com/acme/pro-repo/invitations",
    },
    lic: {
      entitlementType: "license_key",
      title: "License key",
      description: "Activate the app with this key.",
      secret: "ACME-XXXX-YYYY-ZZZZ",
    },
    file: {
      entitlementType: "file_access",
      title: "Download",
      description: "Your files are ready.",
      url: "https://dl.acme.dev/abc",
    },
    disc: {
      entitlementType: "discord_role",
      title: "Discord access",
      description: "Join the private server.",
      url: "https://discord.gg/abc123",
    },
    api: {
      entitlementType: "api_access",
      title: "API key",
      description: "Authenticate API requests.",
      secret: "sk_live_abc123",
    },
  };

  const args = {
    customer,
    merchant,
    entitlements: [
      { entitlement: entA, instruction: instr.gh! },
      { entitlement: entB, instruction: instr.lic! },
      { entitlement: entC, instruction: instr.file! },
      { entitlement: entD, instruction: instr.disc! },
      { entitlement: entE, instruction: instr.api! },
    ],
  };

  const html = renderAccessGrantedEmail(args);
  const text = renderAccessGrantedText(args);

  it("greets the customer by name", () => {
    expect(html).toContain("Hi Dana");
    expect(text).toContain("Hi Dana");
  });

  it("lists each entitlement: github invite, license key, download, discord, api key", () => {
    expect(html).toContain("https://github.com/acme/pro-repo/invitations");
    expect(html).toContain("ACME-XXXX-YYYY-ZZZZ");
    expect(html).toContain("https://dl.acme.dev/abc");
    expect(html).toContain("https://discord.gg/abc123");
    expect(html).toContain("sk_live_abc123");
  });

  it("lists each entitlement in the plaintext version too", () => {
    expect(text).toContain("https://github.com/acme/pro-repo/invitations");
    expect(text).toContain("ACME-XXXX-YYYY-ZZZZ");
    expect(text).toContain("https://dl.acme.dev/abc");
    expect(text).toContain("https://discord.gg/abc123");
    expect(text).toContain("sk_live_abc123");
  });

  it("renders all five entitlement titles", () => {
    for (const t of ["GitHub repository access", "License key", "Download", "Discord access", "API key"]) {
      expect(html).toContain(t);
    }
  });
});

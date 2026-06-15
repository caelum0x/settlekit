import type { Merchant } from "@settlekit/common";

/**
 * Real seed data for the public marketplace. These are concrete domain records
 * that drive the in-memory marketplace-core / agent-services stores so the app
 * renders working listings, search, and agent metadata with no placeholders.
 */

export interface SeedMerchant extends Merchant {
  /** Short public blurb shown on the seller profile page. */
  bio: string;
  websiteUrl?: string;
}

export interface SeedListing {
  merchantSlug: string;
  title: string;
  summary: string;
  tags: string[];
  /** USDC major-unit per-unit price used for price sort + display. */
  priceUsdc: string;
  ratings: number[];
  createdAt: string;
}

export interface SeedAgentService {
  merchantSlug: string;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  network: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  ratings: number[];
  createdAt: string;
}

const ORG_ID = "org_settlekit_market";

export const SEED_MERCHANTS: SeedMerchant[] = [
  {
    id: "mrc_lumen",
    organizationId: ORG_ID,
    displayName: "Lumen Labs",
    slug: "lumen-labs",
    supportEmail: "support@lumenlabs.dev",
    bio: "Vision and OCR tooling for document-heavy workflows. Pay-per-call USDC pricing, no subscriptions.",
    websiteUrl: "https://lumenlabs.dev",
    createdAt: "2026-01-08T10:00:00.000Z",
  },
  {
    id: "mrc_northwind",
    organizationId: ORG_ID,
    displayName: "Northwind Data",
    slug: "northwind-data",
    supportEmail: "hello@northwind.io",
    bio: "Clean, deduplicated company + contact enrichment datasets and a realtime enrichment agent.",
    websiteUrl: "https://northwind.io",
    createdAt: "2026-02-14T09:30:00.000Z",
  },
  {
    id: "mrc_atlas",
    organizationId: ORG_ID,
    displayName: "Atlas Translate",
    slug: "atlas-translate",
    supportEmail: "team@atlastranslate.app",
    bio: "Neural translation across 90+ languages with glossary support. Trusted by localization teams.",
    createdAt: "2026-03-02T14:15:00.000Z",
  },
];

export const SEED_LISTINGS: SeedListing[] = [
  {
    merchantSlug: "lumen-labs",
    title: "Invoice OCR Pack",
    summary:
      "Extract structured line items, totals, and tax fields from scanned invoices. Ships with a tested parser and sample fixtures.",
    tags: ["ocr", "documents", "invoices", "ai"],
    priceUsdc: "49.00",
    ratings: [5, 5, 4, 5, 4],
    createdAt: "2026-01-10T12:00:00.000Z",
  },
  {
    merchantSlug: "northwind-data",
    title: "B2B Company Enrichment Dataset",
    summary:
      "1.2M deduplicated company records with firmographics, tech stack, and verified domains. Monthly refresh included.",
    tags: ["data", "enrichment", "b2b", "sales"],
    priceUsdc: "149.00",
    ratings: [4, 5, 4, 4],
    createdAt: "2026-02-16T08:00:00.000Z",
  },
  {
    merchantSlug: "atlas-translate",
    title: "Localization Starter Kit",
    summary:
      "Glossary templates, ICU message catalogs, and a CLI to wire neural translation into any CI pipeline.",
    tags: ["translation", "localization", "i18n", "cli"],
    priceUsdc: "29.00",
    ratings: [5, 4, 5, 5, 5, 4],
    createdAt: "2026-03-04T16:45:00.000Z",
  },
  {
    merchantSlug: "lumen-labs",
    title: "Receipt Vision SDK",
    summary:
      "Drop-in client SDK for the Receipt Parser agent service. TypeScript + Python bindings with retry and idempotency.",
    tags: ["sdk", "ocr", "ai", "receipts"],
    priceUsdc: "0.00",
    ratings: [4, 4, 3],
    createdAt: "2026-04-01T11:20:00.000Z",
  },
];

export const SEED_AGENT_SERVICES: SeedAgentService[] = [
  {
    merchantSlug: "lumen-labs",
    name: "Receipt Parser",
    description:
      "Send a receipt image URL, get back merchant, total, currency, and itemized lines as structured JSON.",
    endpoint: "https://api.lumenlabs.dev/v1/agents/receipt-parser",
    price: "0.05",
    network: "base",
    inputSchema: {
      type: "object",
      required: ["imageUrl"],
      properties: {
        imageUrl: { type: "string", format: "uri" },
        locale: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        total: { type: "string" },
        currency: { type: "string" },
        lineItems: { type: "array", items: { type: "object" } },
      },
    },
    ratings: [5, 5, 4, 5],
    createdAt: "2026-01-12T10:00:00.000Z",
  },
  {
    merchantSlug: "northwind-data",
    name: "Realtime Company Enrichment",
    description:
      "Given a company domain, return firmographics, employee range, industry codes, and detected technologies.",
    endpoint: "https://api.northwind.io/v1/agents/enrich",
    price: "0.02",
    network: "arc",
    inputSchema: {
      type: "object",
      required: ["domain"],
      properties: {
        domain: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
      },
    },
    ratings: [4, 5, 5],
    createdAt: "2026-02-20T09:00:00.000Z",
  },
  {
    merchantSlug: "atlas-translate",
    name: "Neural Translate",
    description:
      "Translate text between 90+ language pairs with optional glossary enforcement and formality control.",
    endpoint: "https://api.atlastranslate.app/v1/agents/translate",
    price: "0.01",
    network: "base",
    inputSchema: {
      type: "object",
      required: ["text", "targetLang"],
      properties: {
        text: { type: "string" },
        sourceLang: { type: "string" },
        targetLang: { type: "string" },
        formality: { type: "string", enum: ["default", "formal", "informal"] },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        translatedText: { type: "string" },
        detectedSourceLang: { type: "string" },
      },
    },
    ratings: [5, 5, 5, 4, 5],
    createdAt: "2026-03-06T13:00:00.000Z",
  },
];

export const SEED_ORG_ID = ORG_ID;

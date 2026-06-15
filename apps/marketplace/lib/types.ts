import type { MarketplaceListing, AgentService } from "@settlekit/common";
import type { AgentReadableMetadata } from "@settlekit/agent-services";

/**
 * Wire DTOs returned by the marketplace API routes and consumed by pages.
 * Kept flat and JSON-serializable (no bigint) so they survive the network/
 * RSC boundary unchanged.
 */

export interface ListingDTO {
  id: string;
  organizationId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  productId?: string;
  agentServiceId?: string;
  title: string;
  summary: string;
  tags: string[];
  /** USDC major-unit per-unit price; "0.00" means free/included. */
  priceUsdc: string;
  ratingAverage: number;
  ratingCount: number;
  createdAt: string;
}

export interface AgentServiceDTO {
  id: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  productId: string;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  currency: "USDC";
  paymentProtocol: "x402";
  network: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  ratingAverage: number;
  ratingCount: number;
  createdAt: string;
}

export interface SellerDTO {
  id: string;
  slug: string;
  displayName: string;
  bio: string;
  supportEmail?: string;
  websiteUrl?: string;
  totalListings: number;
  publishedListings: number;
  totalRatings: number;
  ratingAverage: number;
  listings: ListingDTO[];
  agentServices: AgentServiceDTO[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: {
    total: number;
  };
}

export type { AgentReadableMetadata, MarketplaceListing, AgentService };

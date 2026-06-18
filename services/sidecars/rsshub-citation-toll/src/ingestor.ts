/**
 * Ingest RSS items as citeable, x402-priced sources.
 *
 * For each item we resolve the author's payout wallet via the payee registry
 * (registering it when the item carries one, falling back to an escrow wallet
 * otherwise), create a citation-toll `Source`, and register it so the toll
 * router can serve and price it. This is the seam to a real RSSHub instance:
 * point a fetcher at RSSHub's JSON and feed the items in.
 */

import { isOk, uuid } from "@settlekit/common";
import {
  InMemorySourceRegistry,
  createSource,
  type Source,
  type SourceStore,
} from "@settlekit/citation-toll";
import { type PayeeRegistry, walletFor } from "@settlekit/payee-registry";
import type { SidecarConfig } from "./config.js";

/** An author as seen on an RSS item. */
export interface RssAuthor {
  /** Stable identity (author URI / feed+name); the payee-registry key. */
  externalId: string;
  displayName?: string;
  /** Wallet to register for this author, if known. */
  wallet?: string;
}

/** A single RSS item to monetize. */
export interface RssItem {
  feedId: string;
  itemId: string;
  title: string;
  author: RssAuthor;
  content: string;
  /** Per-citation toll override; defaults to the sidecar's default. */
  priceUsdc?: string;
}

export interface RssCitationIngestor {
  ingest(item: RssItem): Promise<Source | undefined>;
  ingestMany(items: readonly RssItem[]): Promise<Source[]>;
}

export interface IngestorDeps {
  registry: InMemorySourceRegistry;
  payees: PayeeRegistry;
  config: SidecarConfig;
  sourceStore?: SourceStore;
}

export function createRssIngestor(deps: IngestorDeps): RssCitationIngestor {
  async function resolveWallet(author: RssAuthor): Promise<string | undefined> {
    if (author.wallet !== undefined && author.wallet.length > 0) {
      await deps.payees.register({
        kind: "rss",
        externalId: author.externalId,
        wallet: author.wallet,
        ...(author.displayName !== undefined ? { displayName: author.displayName } : {}),
      });
      return author.wallet;
    }
    return walletFor(deps.payees, "rss", author.externalId, deps.config.escrowWallet);
  }

  async function ingest(item: RssItem): Promise<Source | undefined> {
    const wallet = await resolveWallet(item.author);
    if (wallet === undefined) {
      return undefined;
    }
    const created = createSource({
      organizationId: deps.config.organizationId,
      title: item.title,
      authorWallet: wallet,
      priceUsdc: item.priceUsdc ?? deps.config.defaultPriceUsdc,
      body: item.content,
      summary: item.title,
      network: deps.config.network,
    });
    if (!isOk(created)) {
      return undefined;
    }
    const source: Source = created.value;
    deps.registry.add(source);
    if (deps.sourceStore !== undefined) {
      await deps.sourceStore.save(source);
    }
    return source;
  }

  return {
    ingest,
    async ingestMany(items: readonly RssItem[]): Promise<Source[]> {
      const out: Source[] = [];
      for (const item of items) {
        const source = await ingest(item);
        if (source !== undefined) {
          out.push(source);
        }
      }
      return out;
    },
  };
}

/** Stable access id for one paid citation (used to group royalty legs). */
export function newAccessId(): string {
  return `acc_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

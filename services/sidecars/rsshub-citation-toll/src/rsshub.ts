/**
 * Fetch a live RSSHub feed (JSON Feed format) and map it to {@link RssItem}s
 * ready for ingestion. RSSHub serves any route as JSON Feed when the `.json`
 * suffix is used (e.g. `https://rsshub.app/github/issue/owner/repo.json`).
 *
 * The mapping is pure and tested; the fetch is a thin wrapper so a real RSSHub
 * instance is one config value away.
 */

import type { RssItem } from "./ingestor.js";

/** JSON Feed author (https://jsonfeed.org). */
interface JsonFeedAuthor {
  name?: string;
  url?: string;
}

/** A JSON Feed item. */
interface JsonFeedItem {
  id?: string;
  url?: string;
  title?: string;
  content_html?: string;
  content_text?: string;
  authors?: JsonFeedAuthor[];
  author?: JsonFeedAuthor;
}

/** A JSON Feed document. */
export interface JsonFeed {
  title?: string;
  items?: JsonFeedItem[];
}

function authorIdentity(item: JsonFeedItem, feedTitle: string): { externalId: string; displayName?: string } {
  const author = item.authors?.[0] ?? item.author;
  const externalId = author?.url ?? author?.name ?? feedTitle;
  return author?.name !== undefined ? { externalId, displayName: author.name } : { externalId };
}

/** Map a JSON Feed document to ingestable RSS items. */
export function mapJsonFeed(feed: JsonFeed, feedId: string): RssItem[] {
  const items = feed.items ?? [];
  const out: RssItem[] = [];
  for (const item of items) {
    const itemId = item.id ?? item.url;
    const content = item.content_html ?? item.content_text;
    if (itemId === undefined || content === undefined) {
      continue;
    }
    out.push({
      feedId,
      itemId,
      title: item.title ?? itemId,
      author: authorIdentity(item, feed.title ?? feedId),
      content,
    });
  }
  return out;
}

/** Fetch an RSSHub JSON feed and map it to {@link RssItem}s. */
export async function fetchRssHubFeed(
  url: string,
  feedId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RssItem[]> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`RSSHub fetch failed: ${response.status}`);
  }
  const feed = (await response.json()) as JsonFeed;
  return mapJsonFeed(feed, feedId);
}

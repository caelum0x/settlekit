/**
 * Poll one or more live RSSHub feeds on an interval and ingest new items as
 * priced citeable sources. This is the runner that turns the sidecar from a
 * passive endpoint into a service that continuously monetizes a real feed.
 */

import type { RssCitationIngestor } from "./ingestor.js";
import { fetchRssHubFeed } from "./rsshub.js";

/** A feed to poll: its RSSHub JSON URL and a stable feed id. */
export interface FeedSource {
  url: string;
  feedId: string;
}

export interface FeedPollerDeps {
  ingestor: RssCitationIngestor;
  feeds: readonly FeedSource[];
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export interface FeedPoller {
  /** Poll every feed once; returns how many sources were ingested. */
  tick(): Promise<number>;
  start(): void;
  stop(): void;
}

export function createFeedPoller(deps: FeedPollerDeps): FeedPoller {
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick(): Promise<number> {
    let ingested = 0;
    for (const feed of deps.feeds) {
      try {
        const items = await fetchRssHubFeed(feed.url, feed.feedId, deps.fetchImpl);
        const sources = await deps.ingestor.ingestMany(items);
        ingested += sources.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.log?.(`feed ${feed.feedId} poll failed: ${message}`);
      }
    }
    return ingested;
  }

  return {
    tick,
    start(): void {
      timer = setInterval(() => {
        void tick();
      }, deps.intervalMs ?? 60_000);
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

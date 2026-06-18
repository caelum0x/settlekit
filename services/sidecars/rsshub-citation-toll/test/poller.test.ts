import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createSidecar } from "../src/sidecar.js";
import { createFeedPoller } from "../src/poller.js";
import type { JsonFeed } from "../src/rsshub.js";

function jsonResponse(feed: JsonFeed): Response {
  return new Response(JSON.stringify(feed), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createFeedPoller", () => {
  it("fetches a live feed and ingests its items as priced sources", async () => {
    const sidecar = createSidecar(loadConfig({ ESCROW_WALLET: "0xEscrow" } as unknown as NodeJS.ProcessEnv));
    const feed: JsonFeed = {
      title: "Example",
      items: [
        { id: "p1", title: "One", content_html: "a", authors: [{ name: "Ada", url: "u/ada" }] },
        { id: "p2", title: "Two", content_text: "b", authors: [{ name: "Bo", url: "u/bo" }] },
      ],
    };
    const fetchImpl = (async () => jsonResponse(feed)) as unknown as typeof fetch;

    const poller = createFeedPoller({
      ingestor: sidecar.ingestor,
      feeds: [{ url: "https://rsshub.test/example.json", feedId: "example" }],
      fetchImpl,
    });

    const ingested = await poller.tick();
    expect(ingested).toBe(2);
    expect(sidecar.registry.all()).toHaveLength(2);
  });

  it("survives a feed fetch failure without throwing", async () => {
    const sidecar = createSidecar(loadConfig({ ESCROW_WALLET: "0xEscrow" } as unknown as NodeJS.ProcessEnv));
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const poller = createFeedPoller({
      ingestor: sidecar.ingestor,
      feeds: [{ url: "https://rsshub.test/bad.json", feedId: "bad" }],
      fetchImpl,
    });
    await expect(poller.tick()).resolves.toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { mapJsonFeed, type JsonFeed } from "../src/rsshub.js";

describe("mapJsonFeed", () => {
  it("maps JSON Feed items to ingestable RSS items", () => {
    const feed: JsonFeed = {
      title: "Example Blog",
      items: [
        {
          id: "post-1",
          title: "Nanopayments",
          content_html: "<p>value as small as $0.000001</p>",
          authors: [{ name: "Ada", url: "https://blog.example/ada" }],
        },
        {
          id: "post-2",
          title: "No author",
          content_text: "plain text body",
        },
      ],
    };

    const items = mapJsonFeed(feed, "example-feed");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      feedId: "example-feed",
      itemId: "post-1",
      title: "Nanopayments",
      author: { externalId: "https://blog.example/ada", displayName: "Ada" },
    });
    // Falls back to the feed title as the author identity when none is given.
    expect(items[1]?.author.externalId).toBe("Example Blog");
  });

  it("skips items without an id or content", () => {
    const feed: JsonFeed = {
      title: "f",
      items: [{ title: "no id, no content" }, { id: "ok", content_text: "body" }],
    };
    expect(mapJsonFeed(feed, "f")).toHaveLength(1);
  });
});

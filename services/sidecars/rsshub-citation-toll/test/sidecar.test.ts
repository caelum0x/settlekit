import { describe, expect, it } from "vitest";
import { compareMoney, money } from "@settlekit/common";
import { payAndFetch } from "@settlekit/x402-client";
import { loadConfig } from "../src/config.js";
import { createSidecar } from "../src/sidecar.js";
import type { RssItem } from "../src/ingestor.js";

function testConfig() {
  return loadConfig({
    ORG_ID: "org_test",
    DEFAULT_TOLL_USDC: "0.0005",
    NETWORK: "arc",
    ESCROW_WALLET: "0xEscrow",
  } as unknown as NodeJS.ProcessEnv);
}

const item = (over: Partial<RssItem> = {}): RssItem => ({
  feedId: "feed1",
  itemId: "item1",
  title: "Lepton reborn for machines",
  author: { externalId: "author:ada", displayName: "Ada", wallet: "0xAda" },
  content: "Value as small as $0.000001, settled in under half a second.",
  ...over,
});

describe("rsshub-citation-toll sidecar", () => {
  it("ingests an item, charges the x402 toll, records and settles the royalty", async () => {
    const sidecar = createSidecar(testConfig());

    // Ingest via the admin endpoint.
    const ingestRes = await sidecar.app.request("/admin/feeds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [item()] }),
    });
    expect(ingestRes.status).toBe(200);
    const { data } = (await ingestRes.json()) as { data: { ingested: number; sourceIds: string[] } };
    expect(data.ingested).toBe(1);
    const sourceId = data.sourceIds[0]!;

    // An agent pays the citation toll (in-process via the demo settler).
    const result = await payAndFetch(`http://sidecar.test/articles/${sourceId}`, {
      fetcher: (req) => Promise.resolve(sidecar.app.fetch(req)),
      settler: sidecar.demoSettler,
      from: "0xAgent",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.paid).toBe(true);
    const body = (await result.value.response.json()) as { title: string };
    expect(body.title).toBe("Lepton reborn for machines");

    // The royalty leg was recorded pending, to the author's wallet.
    const pending = await sidecar.royaltyLegStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.wallet).toBe("0xAda");

    // Sweep settles it via the settlement spine.
    const sweepRes = await sidecar.app.request("/admin/sweep", { method: "POST" });
    const sweep = (await sweepRes.json()) as { data: { processed: number; failed: number } };
    expect(sweep.data.processed).toBe(1);
    expect(sweep.data.failed).toBe(0);
    expect(await sidecar.royaltyLegStore.listPending()).toHaveLength(0);
  });

  it("falls back to the escrow wallet for an unregistered author", async () => {
    const sidecar = createSidecar(testConfig());
    const source = await sidecar.ingestor.ingest(
      item({ author: { externalId: "author:unknown" } }),
    );
    expect(source?.authorWallet).toBe("0xEscrow");
  });

  it("returns a 402 challenge before payment", async () => {
    const sidecar = createSidecar(testConfig());
    const [src] = await sidecar.ingestor.ingestMany([item()]);
    const res = await sidecar.app.request(`/articles/${src!.id}`);
    expect(res.status).toBe(402);
    const challenge = (await res.json()) as { accepts: Array<{ amount: string }> };
    expect(compareMoney(money(challenge.accepts[0]!.amount), money("0.0005"))).toBe(0);
  });
});

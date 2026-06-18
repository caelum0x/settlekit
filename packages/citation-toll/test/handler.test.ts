import { describe, expect, it } from "vitest";
import { compareMoney, isOk } from "@settlekit/common";
import { createLocalSettlement, payAndFetch } from "@settlekit/x402-client";
import { InMemorySourceRegistry, createSource } from "../src/registry.js";
import { createCitationTollRouter } from "../src/handler.js";
import type { RoyaltyDistribution } from "../src/types.js";

const BASE = "https://toll.test";

function buildRegistry(): { registry: InMemorySourceRegistry; sourceId: string } {
  const registry = new InMemorySourceRegistry();
  const created = createSource({
    organizationId: "org_lepton",
    title: "Nanopayments 101",
    authorWallet: "0x000000000000000000000000000000000000aaaa",
    priceUsdc: "0.001",
    body: "value as small as $0.000001, settled in under half a second",
  });
  if (!isOk(created)) throw new Error("createSource failed");
  registry.add(created.value);
  return { registry, sourceId: created.value.id };
}

describe("citation-toll router (closed loop)", () => {
  it("gates content behind an x402 toll and settles the royalty split", async () => {
    const { registry, sourceId } = buildRegistry();
    const { settler, verify } = createLocalSettlement();

    const distributions: RoyaltyDistribution[] = [];
    const router = createCitationTollRouter(registry, {
      verify,
      distributor: (d) => {
        distributions.push(d);
      },
    });

    const result = await payAndFetch(`${BASE}/articles/${sourceId}`, {
      fetcher: router,
      settler,
      from: "0xagent",
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.paid).toBe(true);
    const body = (await result.value.response.json()) as { title: string; body: string };
    expect(body.title).toBe("Nanopayments 101");

    expect(distributions).toHaveLength(1);
    const dist = distributions[0];
    if (dist === undefined) return;
    expect(dist.gross.amount).toBe("0.001");
    // Single author keeps the whole distributable amount.
    expect(dist.legs).toHaveLength(1);
    expect(compareMoney(dist.legs[0]!.amount, dist.distributable)).toBe(0);
  });

  it("returns 404 for an unknown source without charging", async () => {
    const { registry } = buildRegistry();
    const { settler, verify } = createLocalSettlement();
    const router = createCitationTollRouter(registry, { verify });

    const result = await payAndFetch(`${BASE}/articles/src_missing`, {
      fetcher: router,
      settler,
      from: "0xagent",
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.paid).toBe(false);
    expect(result.value.response.status).toBe(404);
  });
});

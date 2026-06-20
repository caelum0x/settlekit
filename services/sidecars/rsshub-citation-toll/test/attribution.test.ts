import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createSidecar } from "../src/sidecar.js";
import type { RssItem } from "../src/ingestor.js";

const ITEM: RssItem = {
  feedId: "research",
  itemId: "p1",
  title: "Arc nanopayments",
  author: { externalId: "u/ada", displayName: "Ada", wallet: "0xAda" },
  content:
    "The Arc network settles USDC nanopayments gas-free using Gateway burn intents, " +
    "so an agent can pay a fraction of a cent per citation batched into one on-chain settlement.",
};

function sidecar() {
  return createSidecar(loadConfig({ ESCROW_WALLET: "0xEscrow" } as unknown as NodeJS.ProcessEnv));
}

async function post(app: ReturnType<typeof sidecar>["app"], path: string, body: unknown) {
  const res = await app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { data?: unknown; error?: string } };
}

describe("POST /attribution/detect", () => {
  it("flags an agent answer grounded in an ingested source and quotes the toll", async () => {
    const s = sidecar();
    await s.ingestor.ingest(ITEM);

    const { status, json } = await post(s.app, "/attribution/detect", {
      text: "an agent can pay a fraction of a cent per citation batched into one on-chain settlement",
    });
    expect(status).toBe(200);
    const data = json.data as {
      grounded: boolean;
      matches: { sourceId: string; wallet?: string }[];
      quoteUsdc: string;
    };
    expect(data.grounded).toBe(true);
    expect(data.matches[0]?.wallet).toBe("0xAda");
    expect(data.quoteUsdc).toBe("0.0005"); // one matched source at the default toll
  });

  it("does not flag unrelated text", async () => {
    const s = sidecar();
    await s.ingestor.ingest(ITEM);
    const { json } = await post(s.app, "/attribution/detect", {
      text: "a recipe for sourdough bread with rye flour and a long cold ferment",
    });
    expect((json.data as { grounded: boolean }).grounded).toBe(false);
  });

  it("rejects a missing text field", async () => {
    const s = sidecar();
    const { status } = await post(s.app, "/attribution/detect", {});
    expect(status).toBe(400);
  });
});

describe("proof-of-citation lifecycle", () => {
  it("issues, verifies once, and rejects a replay", async () => {
    const s = sidecar();
    const issued = await post(s.app, "/attribution/proof", {
      agent: "agent_1",
      accessId: "acc_1",
      sourceIds: ["src_a"],
      amountUsdc: "0.0005",
      ttlSeconds: 300,
    });
    expect(issued.status).toBe(200);
    const proof = issued.json.data as { signature: string; nonce: string };
    expect(proof.signature).toMatch(/^[0-9a-f]+$/);
    expect(await s.proofStore.findByNonce(proof.nonce)).toBeDefined();

    const first = await post(s.app, "/attribution/verify", { proof });
    expect((first.json.data as { valid: boolean }).valid).toBe(true);

    const replay = await post(s.app, "/attribution/verify", { proof });
    const replayData = replay.json.data as { valid: boolean; reason?: string };
    expect(replayData.valid).toBe(false);
    expect(replayData.reason).toContain("consumed");
  });

  it("rejects a tampered proof", async () => {
    const s = sidecar();
    const issued = await post(s.app, "/attribution/proof", {
      agent: "agent_1",
      accessId: "acc_1",
      sourceIds: ["src_a"],
    });
    const proof = issued.json.data as Record<string, unknown>;
    const tampered = { ...proof, agent: "agent_evil" };
    const res = await post(s.app, "/attribution/verify", { proof: tampered });
    expect((res.json.data as { valid: boolean }).valid).toBe(false);
  });
});

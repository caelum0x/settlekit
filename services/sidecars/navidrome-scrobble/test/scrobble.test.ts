import { describe, expect, it } from "vitest";
import { compareMoney, money } from "@settlekit/common";
import { loadConfig } from "../src/config.js";
import { createSidecar } from "../src/sidecar.js";
import type { ScrobbleEvent } from "../src/scrobble.js";

function config(over: Record<string, string> = {}) {
  return loadConfig({
    ORG_ID: "org_test",
    NETWORK: "arc",
    PER_LISTEN_USDC: "0.0002",
    MIN_PLAY_SECONDS: "30",
    ESCROW_WALLET: "0xEscrow",
    ...over,
  } as unknown as NodeJS.ProcessEnv);
}

const play = (over: Partial<ScrobbleEvent> = {}): ScrobbleEvent => ({
  userId: "user1",
  trackId: "track1",
  artist: { externalId: "mbid:radiohead", displayName: "Radiohead", wallet: "0xBand" },
  playedSeconds: 200,
  ...over,
});

describe("navidrome-scrobble sidecar", () => {
  it("does not charge for a skip in the first seconds (play-gating)", async () => {
    const sidecar = createSidecar(config());
    const result = await sidecar.processor.process(play({ playedSeconds: 5 }));
    expect(result.charged).toBe(false);
    expect(await sidecar.royaltyLegStore.listPending()).toHaveLength(0);
  });

  it("accrues a per-listen royalty to the artist for a qualifying play", async () => {
    const sidecar = createSidecar(config());
    const result = await sidecar.processor.process(play());
    expect(result.charged).toBe(true);
    expect(result.artistWallet).toBe("0xBand");
    const pending = await sidecar.royaltyLegStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.wallet).toBe("0xBand");
    expect(compareMoney(pending[0]!.amount, money("0.0002"))).toBe(0);
  });

  it("enforces a per-listener daily cap", async () => {
    const sidecar = createSidecar(config({ PER_USER_DAILY_CAP_USDC: "0.0003" }));
    const first = await sidecar.processor.process(play({ trackId: "t1" }));
    const second = await sidecar.processor.process(play({ trackId: "t2" })); // 0.0004 > 0.0003
    expect(first.charged).toBe(true);
    expect(second.charged).toBe(false);
    expect(await sidecar.royaltyLegStore.listPending()).toHaveLength(1);
  });

  it("settles accrued per-listen royalties to the artist via the sweep", async () => {
    const sidecar = createSidecar(config());
    await sidecar.processor.process(play({ trackId: "t1" }));
    await sidecar.processor.process(play({ trackId: "t2" }));
    const res = await sidecar.app.request("/admin/sweep", { method: "POST" });
    const { data } = (await res.json()) as { data: { processed: number } };
    expect(data.processed).toBe(2); // both legs settled
    expect(await sidecar.royaltyLegStore.listPending()).toHaveLength(0);
  });

  it("ingests a scrobble over HTTP", async () => {
    const sidecar = createSidecar(config());
    const res = await sidecar.app.request("/scrobble", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(play()),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { charged: boolean } };
    expect(data.charged).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { compareMoney, money } from "@settlekit/common";
import { loadConfig } from "../src/config.js";
import { createSidecar } from "../src/sidecar.js";

function config() {
  return loadConfig({
    ORG_ID: "org_test",
    NETWORK: "arc",
    PER_SECOND_USDC: "0.0001",
    RESERVE_USDC: "0.05",
    ESCROW_WALLET: "0xEscrow",
  } as unknown as NodeJS.ProcessEnv);
}

describe("owncast-stream sidecar", () => {
  it("meters watched time and accrues it to the streamer", async () => {
    const clock = { t: 0 };
    const sidecar = createSidecar(config(), { now: () => clock.t });

    const opened = await sidecar.sessions.join({
      sessionId: "s1",
      streamer: { externalId: "owncast:dj", displayName: "DJ", wallet: "0xDJ" },
    });
    expect(opened).toBe(true);
    expect(sidecar.sessions.active()).toBe(1);

    clock.t = 10_000; // watched 10 seconds
    const result = await sidecar.sessions.leave("s1");
    expect(result?.accruedUsdc).toBe("0.001"); // 10s * 0.0001
    expect(sidecar.sessions.active()).toBe(0);

    const pending = await sidecar.royaltyLegStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.wallet).toBe("0xDJ");
    expect(compareMoney(pending[0]!.amount, money("0.001"))).toBe(0);
  });

  it("reports the reserved-but-unused refund on leave", async () => {
    const clock = { t: 0 };
    const sidecar = createSidecar(config(), { now: () => clock.t });
    await sidecar.sessions.join({ sessionId: "s1", streamer: { externalId: "owncast:dj", wallet: "0xDJ" } });
    clock.t = 5_000; // watched 5s of a 0.05 reserve
    const result = await sidecar.sessions.leave("s1");
    expect(result?.accruedUsdc).toBe("0.0005");
    expect(result?.refundUsdc).toBe("0.0495");
  });

  it("settles accrued streamer royalties via the sweep", async () => {
    const clock = { t: 0 };
    const sidecar = createSidecar(config(), { now: () => clock.t });
    await sidecar.sessions.join({ sessionId: "s1", streamer: { externalId: "owncast:dj", wallet: "0xDJ" } });
    clock.t = 20_000;
    await sidecar.sessions.leave("s1");

    const res = await sidecar.app.request("/admin/sweep", { method: "POST" });
    const { data } = (await res.json()) as { data: { processed: number } };
    expect(data.processed).toBe(1);
    expect(await sidecar.royaltyLegStore.listPending()).toHaveLength(0);
  });

  it("drives a session over HTTP (join → leave)", async () => {
    const clock = { t: 0 };
    const sidecar = createSidecar(config(), { now: () => clock.t });
    const join = await sidecar.app.request("/sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s9", streamer: { externalId: "owncast:dj", wallet: "0xDJ" } }),
    });
    expect(join.status).toBe(200);
    clock.t = 3_000;
    const leave = await sidecar.app.request("/sessions/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s9" }),
    });
    const { data } = (await leave.json()) as { data: { accruedUsdc: string } };
    expect(data.accruedUsdc).toBe("0.0003");
  });

  it("enforces the bearer token on money-moving routes when one is configured", async () => {
    const cfg = loadConfig({
      ORG_ID: "org_test",
      ESCROW_WALLET: "0xEscrow",
      SIDECAR_AUTH_TOKEN: "s3cret",
    } as unknown as NodeJS.ProcessEnv);
    const sidecar = createSidecar(cfg, { now: () => 0 });
    const joinBody = JSON.stringify({ sessionId: "s1", streamer: { externalId: "owncast:dj", wallet: "0xDJ" } });

    // No token → rejected (an attacker can't bind a payout wallet).
    const noAuth = await sidecar.app.request("/sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: joinBody,
    });
    expect(noAuth.status).toBe(401);

    // Wrong token → rejected.
    const badAuth = await sidecar.app.request("/sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: joinBody,
    });
    expect(badAuth.status).toBe(401);

    // Correct token → allowed.
    const ok = await sidecar.app.request("/sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: joinBody,
    });
    expect(ok.status).toBe(200);

    // Read-only routes stay open regardless.
    expect((await sidecar.app.request("/health")).status).toBe(200);
  });
});

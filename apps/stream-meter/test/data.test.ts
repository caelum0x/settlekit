import { describe, expect, it } from "vitest";
import { money, subtractMoney, toBaseUnits } from "@settlekit/common";
import { SEEDS, buildLiveStream, getMeterContext } from "../lib/data";

describe("getMeterContext (real streaming domain logic, fixed clock)", () => {
  it("is deterministic across two calls", async () => {
    const a = await getMeterContext();
    const b = await getMeterContext();

    expect(b.streams.length).toBe(a.streams.length);
    expect(b.settlements.length).toBe(a.settlements.length);
    expect(b.totals.accrued.amount).toBe(a.totals.accrued.amount);
    expect(b.totals.settled.amount).toBe(a.totals.settled.amount);
    expect(b.totals.due.amount).toBe(a.totals.due.amount);
    expect(b.totals.refundable.amount).toBe(a.totals.refundable.amount);

    for (let i = 0; i < a.streams.length; i++) {
      expect(b.streams[i].snapshot).toEqual(a.streams[i].snapshot);
    }
  });

  it("exposes one StreamView per seed with a doc-projection record", async () => {
    const { streams } = await getMeterContext();
    expect(streams.length).toBe(SEEDS.length);
    for (const view of streams) {
      expect(view.record.id).toBe(view.id);
      expect(view.record.network).toBe("arc");
      // The record projection mirrors the live snapshot.
      expect(view.record.accruedUsdc).toBe(view.snapshot.accruedUsdc);
      expect(view.record.refundableUsdc).toBe(view.snapshot.refundableUsdc);
    }
  });

  it("does not bill a flow-drop window (accrued < rate * watchedSeconds)", async () => {
    const { streams } = await getMeterContext();
    for (const view of streams) {
      const seed = SEEDS.find((s) => s.id === view.id);
      expect(seed).toBeDefined();
      if (seed === undefined) continue;

      const ratePerSec = toBaseUnits(seed.ratePerSecondUsdc);
      const fullBill = ratePerSec * BigInt(seed.watchedSeconds);
      const accrued = toBaseUnits(view.snapshot.accruedUsdc);

      const droppedSeconds = (seed.flowDrops ?? []).reduce((acc, d) => acc + d.forSeconds, 0);
      if (droppedSeconds > 0) {
        // Strictly less than the full bill because the drop window is excluded.
        expect(accrued < fullBill).toBe(true);
        // And exactly the billed seconds (capped at the reserve).
        const expected = ratePerSec * BigInt(seed.watchedSeconds - droppedSeconds);
        const reserve = toBaseUnits(seed.reserveUsdc);
        expect(accrued).toBe(expected < reserve ? expected : reserve);
      } else {
        const reserve = toBaseUnits(seed.reserveUsdc);
        expect(accrued).toBe(fullBill < reserve ? fullBill : reserve);
      }
    }
  });

  it("settlement batches sum to each stream's settledUsdc", async () => {
    const { streams, settlements } = await getMeterContext();
    for (const view of streams) {
      const batches = settlements.filter((s) => s.streamId === view.id);
      const summed = batches.reduce((acc, b) => acc + toBaseUnits(b.amount), 0n);
      expect(summed).toBe(toBaseUnits(view.snapshot.settledUsdc));
    }
  });

  it("refundableUsdc === reserve - accrued for each stream", async () => {
    const { streams } = await getMeterContext();
    for (const view of streams) {
      const seed = SEEDS.find((s) => s.id === view.id);
      if (seed === undefined) continue;
      const expected = subtractMoney(money(seed.reserveUsdc), money(view.snapshot.accruedUsdc));
      expect(view.snapshot.refundableUsdc).toBe(expected.amount);
    }
  });
});

describe("buildLiveStream (same real PaymentStream the client animates)", () => {
  it("accrues against an injected clock without re-implementing the formula", () => {
    let cursor = 1_000_000;
    const seed = SEEDS[0];
    expect(seed).toBeDefined();
    const stream = buildLiveStream(seed, () => cursor);

    // At t0 nothing has accrued.
    expect(stream.snapshot().accruedUsdc).toBe("0");

    // Advance 10 seconds; accrual = rate * 10, capped at reserve.
    cursor += 10_000;
    const accrued = toBaseUnits(stream.snapshot().accruedUsdc);
    const ratePerSec = toBaseUnits(seed.ratePerSecondUsdc);
    expect(accrued).toBe(ratePerSec * 10n);
  });

  it("excludes a flow-paused interval from billing", () => {
    let cursor = 0;
    const seed = SEEDS[0];
    const stream = buildLiveStream(seed, () => cursor);

    cursor += 5_000; // 5s delivered
    stream.reportFlow(false); // delivery drops
    cursor += 100_000; // 100s of no delivery
    stream.reportFlow(true); // delivery resumes
    cursor += 5_000; // 5s delivered

    const ratePerSec = toBaseUnits(seed.ratePerSecondUsdc);
    expect(toBaseUnits(stream.snapshot().accruedUsdc)).toBe(ratePerSec * 10n);
  });
});

import { describe, expect, it } from "vitest";
import type { StreamSettlement } from "../src/types.js";
import { openStream } from "../src/stream.js";

function clock(start = 0) {
  const ref = { t: start };
  return { ref, now: () => ref.t };
}

describe("PaymentStream (per-second settlement)", () => {
  it("accrues value by elapsed time at the authorized rate", () => {
    const { ref, now } = clock();
    const s = openStream({
      payer: "0xviewer",
      payee: "0xstreamer",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });

    ref.t = 1000;
    expect(s.accrued().amount).toBe("0.001");
    ref.t = 2500;
    expect(s.accrued().amount).toBe("0.0025");
    expect(s.due().amount).toBe("0.0025");
  });

  it("batch-settles the due amount and tracks the cumulative total", async () => {
    const { ref, now } = clock();
    const legs: StreamSettlement[] = [];
    const s = openStream({
      payer: "0xviewer",
      payee: "0xstreamer",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });

    ref.t = 3000;
    const first = await s.settle((l) => {
      legs.push(l);
    });
    expect(first.amount.amount).toBe("0.003");
    expect(s.due().amount).toBe("0");

    ref.t = 5000;
    const second = await s.settle((l) => {
      legs.push(l);
    });
    expect(second.amount.amount).toBe("0.002");
    expect(second.settledTotal.amount).toBe("0.005");
    expect(legs).toHaveLength(2);
  });

  it("does not bill paused intervals", () => {
    const { ref, now } = clock();
    const s = openStream({
      payer: "0xv",
      payee: "0xs",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });

    ref.t = 2000;
    expect(s.accrued().amount).toBe("0.002");
    s.pause();
    ref.t = 9000; // 7s paused — must not bill
    expect(s.accrued().amount).toBe("0.002");
    s.resume();
    ref.t = 10000; // 1s more
    expect(s.accrued().amount).toBe("0.003");
  });

  it("pauses the meter on a proof-of-flow drop and resumes on recovery", () => {
    const { ref, now } = clock();
    const s = openStream({
      payer: "0xv",
      payee: "0xs",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });

    ref.t = 1000;
    s.reportFlow(false); // delivery dropped at 1s
    ref.t = 6000; // 5s outage — not billed
    expect(s.snapshot().state).toBe("paused");
    expect(s.snapshot().pauseReason).toBe("flow");
    s.reportFlow(true);
    ref.t = 7000; // 1s after recovery
    expect(s.accrued().amount).toBe("0.002");
  });

  it("caps accrual at the reserve", () => {
    const { ref, now } = clock();
    const s = openStream({
      payer: "0xv",
      payee: "0xs",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });
    ref.t = 1_000_000; // far beyond reserve
    expect(s.accrued().amount).toBe("0.01");
    expect(s.refundable().amount).toBe("0");
  });

  it("refunds the reserved-but-unused remainder on close", async () => {
    const { ref, now } = clock();
    const s = openStream({
      payer: "0xv",
      payee: "0xs",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now,
    });
    ref.t = 3500; // accrue 0.0035 of a 0.01 reserve
    const { finalSettlement, refund } = await s.close();
    expect(finalSettlement.amount.amount).toBe("0.0035");
    expect(refund.amount).toBe("0.0065");
    // After close the meter is frozen.
    ref.t = 50_000;
    expect(s.accrued().amount).toBe("0.0035");
  });
});

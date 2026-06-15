import { money, SettleKitError } from "@settlekit/common";
import { describe, expect, it } from "vitest";

import { InMemoryMeterStore, UsageService } from "../src/index.js";

const meterRef = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  metric: "api_calls",
} as const;

const balanceRef = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
} as const;

const jan = new Date("2026-01-01T00:00:00.000Z");
const feb = new Date("2026-02-01T00:00:00.000Z");

function svc() {
  return new UsageService(new InMemoryMeterStore(), "monthly");
}

describe("UsageService metering", () => {
  it("creates a meter on first record and accumulates across calls", async () => {
    const service = svc();
    await service.record(meterRef, 5, jan);
    const meter = await service.record(meterRef, 7, jan);

    expect(meter.value).toBe(12);

    const fetched = await service.getMeter(meterRef, jan);
    expect(fetched?.value).toBe(12);
  });

  it("computes a charge from persisted usage", async () => {
    const service = svc();
    await service.record(meterRef, 1000, jan);
    const charge = await service.charge(meterRef, jan, money("0.001"));
    expect(charge).toEqual(money("1.000000"));
  });

  it("throws not_found when charging a non-existent meter", async () => {
    const service = svc();
    await expect(service.charge(meterRef, jan, money("0.001"))).rejects.toBeInstanceOf(SettleKitError);
  });

  it("evaluates limits, treating a missing meter as zero usage", async () => {
    const service = svc();
    const empty = await service.limit(meterRef, jan, 100);
    expect(empty.value).toBe(0);
    expect(empty.withinLimit).toBe(true);

    await service.record(meterRef, 150, jan);
    const over = await service.limit(meterRef, jan, 100);
    expect(over.exceeded).toBe(true);
  });

  it("rolls a period into a fresh zeroed meter", async () => {
    const service = svc();
    await service.record(meterRef, 50, jan);
    const next = await service.rollPeriod(meterRef, feb);
    expect(next.value).toBe(0);
    expect(next.periodStart).toBe("2026-02-01T00:00:00.000Z");

    const janMeter = await service.getMeter(meterRef, jan);
    expect(janMeter?.value).toBe(50);
  });
});

describe("UsageService credits", () => {
  it("grants on first use and accumulates", async () => {
    const service = svc();
    await service.grant(balanceRef, 100);
    const bal = await service.grant(balanceRef, 50);
    expect(bal.creditsRemaining).toBe(150);
    expect(bal.creditsGranted).toBe(150);
  });

  it("consumes credits and persists the new remaining", async () => {
    const service = svc();
    await service.grant(balanceRef, 100);
    const after = await service.consume(balanceRef, 30);
    expect(after.creditsRemaining).toBe(70);

    const fetched = await service.getBalance(balanceRef);
    expect(fetched?.creditsRemaining).toBe(70);
  });

  it("throws insufficient_credits when over-consuming", async () => {
    const service = svc();
    await service.grant(balanceRef, 10);
    await expect(service.consume(balanceRef, 25)).rejects.toMatchObject({
      code: "insufficient_credits",
    });
  });

  it("throws not_found when consuming with no balance", async () => {
    const service = svc();
    await expect(service.consume(balanceRef, 1)).rejects.toMatchObject({ code: "not_found" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { proposal } from "../src/actions.js";
import {
  ESCALATION_TTL_MS, EscalationQueue, EscalationStateError, approveEscalation, expireEscalation, isExpired,
  openEscalation, rejectEscalation,
} from "../src/escalation.js";
import { InMemoryOperatorStore } from "../src/store.js";
import { T0, U, VENDOR } from "./fixtures.js";

const P = proposal({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 800n * U, ref: "bill_1" }, "big bill", ["defer"], 0.7);
const input = { id: "esc_1", orgId: "org_1", decisionId: "dec_1", proposal: P, reasons: ["above_escalation_threshold"] };
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("escalation lifecycle (pure)", () => {
  it("opens pending with a 72h expiry", () => {
    const e = openEscalation(input, T0);
    expect(e.status).toBe("pending");
    expect(Date.parse(e.expiresAt) - Date.parse(e.createdAt)).toBe(ESCALATION_TTL_MS);
    expect(isExpired(e, later(ESCALATION_TTL_MS))).toBe(false);
    expect(isExpired(e, later(ESCALATION_TTL_MS + 1))).toBe(true);
  });

  it("approves and rejects without mutating the original", () => {
    const e = openEscalation(input, T0);
    const approved = approveEscalation(e, "owner", later(1000));
    expect(approved).toMatchObject({ status: "approved", resolvedBy: "owner" });
    expect(e.status).toBe("pending");
    const rejected = rejectEscalation(e, "owner", "vendor unknown", later(1000));
    expect(rejected).toMatchObject({ status: "rejected", resolution: "vendor unknown" });
  });

  it("refuses double resolution, empty reasons and late approval", () => {
    const e = openEscalation(input, T0);
    const approved = approveEscalation(e, "owner", T0);
    expect(() => approveEscalation(approved, "owner", T0)).toThrow(EscalationStateError);
    expect(() => rejectEscalation(e, "owner", "  ", T0)).toThrow(/reason/);
    expect(() => approveEscalation(e, "owner", later(ESCALATION_TTL_MS + 1))).toThrow(/expired/);
  });

  it("expires only stale pending escalations, with a logged reason", () => {
    const e = openEscalation(input, T0);
    expect(() => expireEscalation(e, later(1))).toThrow(/not expired/);
    const expired = expireEscalation(e, later(ESCALATION_TTL_MS + 1));
    expect(expired).toMatchObject({ status: "expired", resolvedBy: "system" });
    expect(expired.resolution).toMatch(/72h/);
    expect(() => expireEscalation(expired, later(ESCALATION_TTL_MS + 2))).toThrow(EscalationStateError);
  });
});

describe("EscalationQueue", () => {
  it("persists every transition and notifies after saving", async () => {
    let now = T0;
    const store = new InMemoryOperatorStore();
    const events: string[] = [];
    const notify = vi.fn(async (e, event: string) => {
      expect(await store.getEscalation(e.orgId, e.id)).toEqual(e);
      events.push(event);
    });
    const queue = new EscalationQueue(store, { now: () => now, notify });

    await queue.open(input);
    await queue.open({ ...input, id: "esc_2" });
    await queue.open({ ...input, id: "esc_3" });
    expect(await queue.listPending("org_1")).toHaveLength(3);

    await queue.approve("org_1", "esc_1", "owner");
    await queue.reject("org_1", "esc_2", "owner", "duplicate invoice");
    now = later(ESCALATION_TTL_MS + 1);
    const expired = await queue.expireStale("org_1");

    expect(expired.map((e) => e.id)).toEqual(["esc_3"]);
    expect(await queue.listPending("org_1")).toHaveLength(0);
    expect((await store.getEscalation("org_1", "esc_1"))?.status).toBe("approved");
    expect(events).toEqual(["opened", "opened", "opened", "approved", "rejected", "expired"]);
  });

  it("scopes by org and reports unknown ids", async () => {
    const queue = new EscalationQueue(new InMemoryOperatorStore(), { now: () => T0 });
    await queue.open(input);
    await expect(queue.approve("org_2", "esc_1", "owner")).rejects.toThrow(/not found/);
    await expect(queue.reject("org_1", "missing", "owner", "x")).rejects.toThrow(EscalationStateError);
  });

  it("surfaces notifier failures after the state is saved", async () => {
    const store = new InMemoryOperatorStore();
    const queue = new EscalationQueue(store, { now: () => T0, notify: async () => { throw new Error("smtp down"); } });
    await expect(queue.open(input)).rejects.toThrow("smtp down");
    expect(await store.getEscalation("org_1", "esc_1")).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  EscrowService,
  InMemoryEscrowStore,
  approveEscrowWork,
  assertTransition,
  canTransition,
  createEscrowTask,
  isTerminalStatus,
  openEscrowDispute,
  releaseEscrow,
  resolveEscrowDispute,
} from "../src/index.js";

function newTask() {
  return createEscrowTask({
    organizationId: "org_1",
    buyerCustomerId: "cus_buyer",
    title: "Task",
    description: "desc",
    amount: "10",
    currency: "USDC",
  });
}

describe("escrow transition guard", () => {
  it("rejects releasing a created task as a conflict", () => {
    let thrown: unknown;
    try {
      releaseEscrow({ ...newTask(), workerCustomerId: "cus_worker" }, "0xrelease");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SettleKitError);
    expect((thrown as SettleKitError).code).toBe("conflict");
    expect((thrown as SettleKitError).httpStatus).toBe(409);
  });

  it("rejects approving a created task", () => {
    expect(() => approveEscrowWork(newTask())).toThrowError(SettleKitError);
  });

  it("assertTransition throws a conflict for illegal moves", () => {
    expect(() => assertTransition("created", "release")).toThrowError(/Illegal escrow transition/);
    expect(() => assertTransition("released", "refund")).toThrowError(/Illegal escrow transition/);
  });

  it("canTransition reflects the legal transition table", () => {
    expect(canTransition("created", "fund")).toBe(true);
    expect(canTransition("created", "release")).toBe(false);
    expect(canTransition("approved", "release")).toBe(true);
    expect(canTransition("disputed", "resolve_dispute_refund")).toBe(true);
  });

  it("marks released and refunded as terminal", () => {
    expect(isTerminalStatus("released")).toBe(true);
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(isTerminalStatus("created")).toBe(false);
  });

  it("resolves a dispute by refund", () => {
    const { task: disputed } = openEscrowDispute({ ...newTask(), status: "funded" }, "no delivery");
    expect(disputed.status).toBe("disputed");
    const result = resolveEscrowDispute(disputed, { outcome: "refund", reason: "buyer wins" });
    expect(result.task.status).toBe("refunded");
  });

  it("rejects resolving a dispute on a non-disputed task", () => {
    expect(() =>
      resolveEscrowDispute(newTask(), { outcome: "refund", reason: "x" }),
    ).toThrowError(/Cannot resolve a dispute/);
  });

  it("service surfaces conflict for illegal transition order", async () => {
    const store = new InMemoryEscrowStore();
    const service = new EscrowService(store);
    const created = await service.createTask({
      organizationId: "org_1",
      buyerCustomerId: "cus_buyer",
      title: "Task",
      description: "desc",
      amount: "10",
    });
    await expect(service.approve(created.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.assignWorker(created.id, "cus_worker")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("service throws not_found for unknown task", async () => {
    const service = new EscrowService(new InMemoryEscrowStore());
    await expect(service.fundTask("esc_missing", "0xfund")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

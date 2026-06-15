import { describe, expect, it } from "vitest";
import {
  EscrowService,
  InMemoryEscrowStore,
  approveEscrowWork,
  assignWorkerToTask,
  createEscrowTask,
  fundEscrowTask,
  releaseEscrow,
  submitEscrowWork,
} from "../src/index.js";

function newTask() {
  return createEscrowTask({
    organizationId: "org_1",
    buyerCustomerId: "cus_buyer",
    title: "Fix bug",
    description: "Patch the auth race condition",
    amount: "100.00",
    currency: "USDC",
  });
}

describe("escrow release (pure transitions)", () => {
  it("moves created -> funded -> assigned -> submitted -> approved -> released", () => {
    const created = newTask();
    expect(created.status).toBe("created");

    const { task: funded } = fundEscrowTask(created, "0xfund");
    expect(funded.status).toBe("funded");
    expect(funded.fundingTxHash).toBe("0xfund");

    const assigned = assignWorkerToTask(funded, "cus_worker");
    expect(assigned.status).toBe("assigned");
    expect(assigned.workerCustomerId).toBe("cus_worker");

    const { task: submitted } = submitEscrowWork(assigned, "Here is the PR");
    expect(submitted.status).toBe("submitted");

    const { task: approved } = approveEscrowWork(submitted);
    expect(approved.status).toBe("approved");

    const { task: released, release } = releaseEscrow(approved, "0xrelease");
    expect(released.status).toBe("released");
    expect(released.releaseTxHash).toBe("0xrelease");
    expect(release.workerCustomerId).toBe("cus_worker");
    expect(release.amount).toBe("100");
  });

  it("never mutates the input task", () => {
    const created = newTask();
    const { task: funded } = fundEscrowTask(created, "0xfund");
    expect(created.status).toBe("created");
    expect(created.fundingTxHash).toBeUndefined();
    expect(funded).not.toBe(created);
  });

  it("requires a release tx hash", () => {
    const created = newTask();
    const { task: funded } = fundEscrowTask(created, "0xfund");
    const assigned = assignWorkerToTask(funded, "cus_worker");
    const { task: submitted } = submitEscrowWork(assigned, "done");
    const { task: approved } = approveEscrowWork(submitted);
    expect(() => releaseEscrow(approved, "  ")).toThrowError(/releaseTxHash is required/);
  });
});

describe("escrow release (service + store)", () => {
  it("persists every transition and records audit events", async () => {
    const store = new InMemoryEscrowStore();
    const service = new EscrowService(store);

    const created = await service.createTask({
      organizationId: "org_1",
      buyerCustomerId: "cus_buyer",
      title: "Build feature",
      description: "ship it",
      amount: "250",
    });

    await service.fundTask(created.id, "0xfund");
    await service.assignWorker(created.id, "cus_worker");
    await service.submitWork(created.id, "delivered");
    await service.approve(created.id);
    const released = await service.release(created.id, "0xrelease");

    expect(released.status).toBe("released");

    const persisted = await service.getTask(created.id);
    expect(persisted?.status).toBe("released");
    expect(store.fundingEvents).toHaveLength(1);
    expect(store.releaseEvents).toHaveLength(1);
    expect(store.releaseEvents[0]?.releaseTxHash).toBe("0xrelease");
    expect(store.submissionEvents).toHaveLength(1);
    expect(store.reviewEvents).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  EscrowService,
  InMemoryEscrowStore,
  assignWorkerToTask,
  createEscrowTask,
  fundEscrowTask,
  refundEscrow,
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

describe("escrow refund (pure transitions)", () => {
  it("refunds a created task", () => {
    const { task, refund } = refundEscrow(newTask(), "buyer cancelled");
    expect(task.status).toBe("refunded");
    expect(refund.reason).toBe("buyer cancelled");
    expect(refund.buyerCustomerId).toBe("cus_buyer");
    expect(refund.amount).toBe("10");
  });

  it("refunds a funded task", () => {
    const { task: funded } = fundEscrowTask(newTask(), "0xfund");
    const { task } = refundEscrow(funded, "scope changed");
    expect(task.status).toBe("refunded");
  });

  it("refunds an assigned task", () => {
    const { task: funded } = fundEscrowTask(newTask(), "0xfund");
    const assigned = assignWorkerToTask(funded, "cus_worker");
    const { task } = refundEscrow(assigned, "worker withdrew");
    expect(task.status).toBe("refunded");
  });

  it("requires a refund reason", () => {
    expect(() => refundEscrow(newTask(), "   ")).toThrowError(/reason is required/);
  });

  it("does not mutate the input task", () => {
    const created = newTask();
    refundEscrow(created, "cancel");
    expect(created.status).toBe("created");
  });
});

describe("escrow refund (service + store)", () => {
  it("persists the refund and records the event", async () => {
    const store = new InMemoryEscrowStore();
    const service = new EscrowService(store);
    const created = await service.createTask({
      organizationId: "org_1",
      buyerCustomerId: "cus_buyer",
      title: "Task",
      description: "desc",
      amount: "10",
    });
    await service.fundTask(created.id, "0xfund");
    const refunded = await service.refund(created.id, "buyer changed mind");

    expect(refunded.status).toBe("refunded");
    expect((await service.getTask(created.id))?.status).toBe("refunded");
    expect(store.refundEvents).toHaveLength(1);
    expect(store.refundEvents[0]?.reason).toBe("buyer changed mind");
  });
});

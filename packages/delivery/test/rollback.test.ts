import { describe, it, expect } from "vitest";
import { createDefaultRegistry, DeliveryRunner } from "../src/index.js";
import { createInMemorySuite } from "./in-memory-clients.js";
import { RecordingLogger, buildContext, fixedNow, instantSleep } from "./fixtures.js";

describe("DeliveryRunner rollback on unrecoverable failure", () => {
  it("retries the failing action up to maxAttempts then rolls back prior successes", async () => {
    // license issuance always fails; github + saas succeed before it.
    const suite = createInMemorySuite({ license: { alwaysFail: true } });
    const ctx = buildContext(suite.clients);
    const registry = createDefaultRegistry();
    const logger = new RecordingLogger();
    const runner = new DeliveryRunner(registry, {
      logger,
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 3 },
    });

    const plan = {
      id: "dplan_test",
      organizationId: ctx.organizationId,
      actions: [
        { type: "github_invite", repoId: "settlekit/private-repo" },
        { type: "saas_entitlement_create", features: { seats: 3 } },
        { type: "license_key_create", policyId: "p1" },
      ],
      createdAt: fixedNow().toISOString(),
    } as const;

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    // Some succeeded, one failed -> partially_failed.
    expect(run.status).toBe("partially_failed");

    const byType = (t: string) => run.actionRuns.find((ar) => ar.action.type === t);
    // The failing action exhausted all attempts.
    expect(byType("license_key_create")?.status).toBe("failed");
    expect(byType("license_key_create")?.attempts).toBe(3);

    // The two prior successes were rolled back (they have a rollback impl).
    expect(byType("github_invite")?.status).toBe("rolled_back");
    expect(byType("saas_entitlement_create")?.status).toBe("rolled_back");

    // The injected clients received the rollback calls.
    expect(suite.github.removed).toHaveLength(1);
    expect(suite.saas.revoked).toHaveLength(1);

    // An error-level log was emitted for the failed action.
    expect(logger.entries.some((e) => e.level === "error")).toBe(true);
  });

  it("stops at a non-retryable failure without exhausting attempts, then rolls back", async () => {
    const suite = createInMemorySuite({ license: { alwaysFail: true, nonRetryable: true } });
    const ctx = buildContext(suite.clients);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 5 },
    });

    const plan = {
      id: "dplan_test2",
      organizationId: ctx.organizationId,
      actions: [
        { type: "github_invite", repoId: "settlekit/private-repo" },
        { type: "license_key_create", policyId: "p1" },
      ],
      createdAt: fixedNow().toISOString(),
    } as const;

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(run.status).toBe("partially_failed");
    const license = run.actionRuns.find((ar) => ar.action.type === "license_key_create");
    // Non-retryable => only a single attempt despite maxAttempts: 5.
    expect(license?.attempts).toBe(1);
    expect(suite.github.removed).toHaveLength(1);
  });

  it("marks the run failed when the very first action fails (nothing to roll back)", async () => {
    const suite = createInMemorySuite({ github: { alwaysFail: true } });
    const ctx = buildContext(suite.clients);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 2 },
    });

    const plan = {
      id: "dplan_test3",
      organizationId: ctx.organizationId,
      actions: [{ type: "github_invite", repoId: "settlekit/private-repo" }],
      createdAt: fixedNow().toISOString(),
    } as const;

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(run.status).toBe("failed");
    expect(run.actionRuns[0]?.status).toBe("failed");
    expect(suite.github.removed).toHaveLength(0);
  });

  it("leaves a succeeded action as-is when its handler has no rollback", async () => {
    // webhook_send has no rollback; license fails after it.
    const suite = createInMemorySuite({ license: { alwaysFail: true } });
    const ctx = buildContext(suite.clients);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 1 },
    });

    const plan = {
      id: "dplan_test4",
      organizationId: ctx.organizationId,
      actions: [
        { type: "webhook_send", url: "https://hooks.example.com/x" },
        { type: "license_key_create", policyId: "p1" },
      ],
      createdAt: fixedNow().toISOString(),
    } as const;

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(run.status).toBe("partially_failed");
    const webhook = run.actionRuns.find((ar) => ar.action.type === "webhook_send");
    // No rollback impl -> stays succeeded.
    expect(webhook?.status).toBe("succeeded");
  });
});

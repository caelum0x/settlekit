import { describe, it, expect } from "vitest";
import { createDefaultRegistry, DeliveryRunner } from "../src/index.js";
import { createInMemorySuite } from "./in-memory-clients.js";
import { RecordingLogger, buildContext, buildPlan, fixedNow, instantSleep } from "./fixtures.js";

describe("DeliveryRunner.run", () => {
  it("executes every action in order and marks the run succeeded", async () => {
    const suite = createInMemorySuite();
    const ctx = buildContext(suite.clients);
    const plan = buildPlan(ctx.organizationId);
    const registry = createDefaultRegistry();
    const logger = new RecordingLogger();
    const runner = new DeliveryRunner(registry, { logger, sleep: instantSleep, now: fixedNow });

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(run.status).toBe("succeeded");
    expect(run.actionRuns).toHaveLength(plan.actions.length);
    expect(run.actionRuns.map((ar) => ar.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(run.actionRuns.map((ar) => ar.action.type)).toEqual([
      "github_invite",
      "license_key_create",
      "saas_entitlement_create",
      "email_send",
    ]);
    expect(run.completedAt).toBe("2026-06-15T00:00:00.000Z");

    // Each handler reached its client exactly once.
    expect(suite.github.invited).toHaveLength(1);
    expect(suite.license.issued).toHaveLength(1);
    expect(suite.saas.entitled).toHaveLength(1);
    expect(suite.email.sent).toHaveLength(1);
  });

  it("records handler output on each action run", async () => {
    const suite = createInMemorySuite();
    const ctx = buildContext(suite.clients);
    const plan = buildPlan(ctx.organizationId);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
    });

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    const licenseRun = run.actionRuns.find((ar) => ar.action.type === "license_key_create");
    expect(licenseRun?.output?.licenseKeyId).toBe(suite.license.issued[0]?.id);
    expect(typeof licenseRun?.output?.key).toBe("string");

    const githubRun = run.actionRuns.find((ar) => ar.action.type === "github_invite");
    expect(githubRun?.output?.permission).toBe("push");
    expect(githubRun?.output?.invitationId).toBe(suite.github.invited[0]?.invitationId);
  });

  it("returns new immutable run snapshots (does not mutate the created run)", async () => {
    const suite = createInMemorySuite();
    const ctx = buildContext(suite.clients);
    const plan = buildPlan(ctx.organizationId);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
    });

    const created = runner.createRun(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });
    const finished = await runner.executePending(created, ctx);

    // The original snapshot is untouched.
    expect(created.status).toBe("pending");
    expect(created.actionRuns.every((ar) => ar.status === "pending")).toBe(true);
    expect(finished).not.toBe(created);
    expect(finished.status).toBe("succeeded");
  });

  it("emits delivery log entries via the injected logger", async () => {
    const suite = createInMemorySuite();
    const ctx = buildContext(suite.clients);
    const plan = buildPlan(ctx.organizationId);
    const logger = new RecordingLogger();
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      logger,
      sleep: instantSleep,
      now: fixedNow,
    });

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(logger.entries.length).toBeGreaterThanOrEqual(plan.actions.length);
    expect(logger.entries.every((e) => e.deliveryRunId === run.id)).toBe(true);
    expect(logger.entries.some((e) => e.level === "info")).toBe(true);
  });

  it("retries a transient failure then succeeds within maxAttempts", async () => {
    // github fails once, then succeeds on the second attempt.
    const suite = createInMemorySuite({ github: { failTimes: 1 } });
    const ctx = buildContext(suite.clients);
    const plan = buildPlan(ctx.organizationId, [
      { type: "github_invite", repoId: "settlekit/private-repo" },
    ]);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 3 },
    });

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });

    expect(run.status).toBe("succeeded");
    expect(run.actionRuns[0]?.attempts).toBe(2);
    expect(suite.github.invited).toHaveLength(1);
  });
});

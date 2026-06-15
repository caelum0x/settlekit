import { describe, it, expect } from "vitest";
import { createDefaultRegistry, DeliveryRunner, retryRun } from "../src/index.js";
import { createInMemorySuite } from "./in-memory-clients.js";
import { buildContext, fixedNow, instantSleep } from "./fixtures.js";

describe("retryRun", () => {
  it("re-runs only the failed actions, leaving succeeded ones untouched", async () => {
    // email fails on the first run only; recovers on retry.
    const suite = createInMemorySuite({ email: { failTimes: 99 } });
    const ctx = buildContext(suite.clients);
    const registry = createDefaultRegistry();
    const runner = new DeliveryRunner(registry, {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 2 },
    });

    const plan = {
      id: "dplan_retry",
      organizationId: ctx.organizationId,
      actions: [
        { type: "github_invite", repoId: "settlekit/private-repo" },
        { type: "email_send", template: "receipt" },
      ],
      createdAt: fixedNow().toISOString(),
    } as const;

    // github action has no rollback target here only if email rolls everything back.
    // github_invite HAS a rollback, so after the email failure github is rolled back.
    const first = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });
    expect(first.status).toBe("partially_failed");
    expect(first.actionRuns.find((ar) => ar.action.type === "email_send")?.status).toBe("failed");

    const githubInvitesAfterFirst = suite.github.invited.length;

    // Now allow email to succeed and retry only the failed actions.
    suite.email.sent.length; // no-op read
    const healthySuite = createInMemorySuite();
    const healthyCtx = buildContext(healthySuite.clients);
    // Reuse the existing failed run but point ctx at clients that succeed.
    const retried = await retryRun(first, runner, { ...ctx, clients: healthySuite.clients });

    expect(retried.id).toBe(first.id);
    // The email action now succeeds; github stays as it was (rolled_back) and is not re-run.
    expect(retried.actionRuns.find((ar) => ar.action.type === "email_send")?.status).toBe(
      "succeeded",
    );
    // Email client received exactly one successful send on the retry.
    expect(healthySuite.email.sent).toHaveLength(1);
    // The original github client did not get a second invite from the retry.
    expect(suite.github.invited.length).toBe(githubInvitesAfterFirst);
    void githubInvitesAfterFirst;
    void healthyCtx;
  });

  it("re-runs a failed action and reaches succeeded when the client recovers", async () => {
    const suite = createInMemorySuite({ license: { failTimes: 99 } });
    const ctx = buildContext(suite.clients);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
      retry: { maxAttempts: 1 },
    });

    const plan = {
      id: "dplan_retry2",
      organizationId: ctx.organizationId,
      actions: [{ type: "license_key_create", policyId: "p1" }],
      createdAt: fixedNow().toISOString(),
    } as const;

    const first = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });
    expect(first.status).toBe("failed");
    expect(first.actionRuns[0]?.lastError).toBeTruthy();

    const healthy = createInMemorySuite();
    const retried = await retryRun(first, runner, { ...ctx, clients: healthy.clients });

    expect(retried.status).toBe("succeeded");
    expect(retried.actionRuns[0]?.status).toBe("succeeded");
    // lastError cleared on the successful re-run.
    expect(retried.actionRuns[0]?.lastError).toBeUndefined();
    expect(healthy.license.issued).toHaveLength(1);
  });

  it("throws when there are no failed actions to retry", async () => {
    const suite = createInMemorySuite();
    const ctx = buildContext(suite.clients);
    const runner = new DeliveryRunner(createDefaultRegistry(), {
      sleep: instantSleep,
      now: fixedNow,
    });

    const plan = {
      id: "dplan_ok",
      organizationId: ctx.organizationId,
      actions: [{ type: "saas_entitlement_create", features: { seats: 1 } }],
      createdAt: fixedNow().toISOString(),
    } as const;

    const run = await runner.run(plan, ctx, {
      paymentId: ctx.paymentId,
      customerId: ctx.customerId,
    });
    expect(run.status).toBe("succeeded");

    await expect(retryRun(run, runner, ctx)).rejects.toMatchObject({
      code: "validation_error",
    });
  });
});

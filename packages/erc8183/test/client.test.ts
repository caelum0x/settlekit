import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  JobClient,
  LocalErc8183Port,
  type LocalErc8183Op,
  configureErc8183,
} from "../src/index.js";

function setup(opts: { throwOn?: readonly LocalErc8183Op[] } = {}): {
  client: JobClient;
  port: LocalErc8183Port;
} {
  const port = new LocalErc8183Port(opts.throwOn !== undefined ? { throwOn: opts.throwOn } : {});
  const client = configureErc8183({ port });
  return { client, port };
}

const VALID = {
  requester: "0xreq",
  worker: "0xwork",
  amountUsdc: "100.00",
  specUri: "ipfs://spec",
};

async function createOk(client: JobClient): Promise<string> {
  const res = await client.createJob(VALID);
  if (!isOk(res)) throw new Error("expected createJob ok");
  return res.value.jobId;
}

describe("happy path", () => {
  it("create -> fund -> submit -> evaluate(pass) -> settle", async () => {
    const { client } = setup();

    const created = await client.createJob(VALID);
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.jobId).toBe("job_1");
    expect(created.value.txHash).toMatch(/^0xlocal/);

    const afterCreate = await client.getJob({ jobId: "job_1" });
    expect(isOk(afterCreate)).toBe(true);
    if (!isOk(afterCreate)) return;
    expect(afterCreate.value.status).toBe("created");
    expect(afterCreate.value.amount.amount).toBe("100");
    expect(afterCreate.value.amount.currency).toBe("USDC");

    const funded = await client.fundEscrow({ jobId: "job_1", amountUsdc: "100.00" });
    expect(isOk(funded)).toBe(true);
    expect(isOk(await client.getJob({ jobId: "job_1" }))).toBe(true);
    const fundedJob = await client.getJob({ jobId: "job_1" });
    if (!isOk(fundedJob)) return;
    expect(fundedJob.value.status).toBe("funded");

    const submitted = await client.submitDeliverable({
      jobId: "job_1",
      deliverableUri: "ipfs://deliverable",
    });
    expect(isOk(submitted)).toBe(true);
    const submittedJob = await client.getJob({ jobId: "job_1" });
    if (!isOk(submittedJob)) return;
    expect(submittedJob.value.status).toBe("submitted");
    expect(submittedJob.value.deliverableUri).toBe("ipfs://deliverable");

    const evaluated = await client.evaluate({ jobId: "job_1", passed: true, scoreOrUri: "0.95" });
    expect(isOk(evaluated)).toBe(true);
    const evaluatedJob = await client.getJob({ jobId: "job_1" });
    if (!isOk(evaluatedJob)) return;
    expect(evaluatedJob.value.status).toBe("evaluated");
    expect(evaluatedJob.value.evaluation?.passed).toBe(true);
    expect(evaluatedJob.value.evaluation?.scoreOrUri).toBe("0.95");

    const settled = await client.settle({ jobId: "job_1" });
    expect(isOk(settled)).toBe(true);
    const settledJob = await client.getJob({ jobId: "job_1" });
    if (!isOk(settledJob)) return;
    expect(settledJob.value.status).toBe("settled");
  });

  it("mints sequential job ids", async () => {
    const { client } = setup();
    expect(await createOk(client)).toBe("job_1");
    expect(await createOk(client)).toBe("job_2");
  });
});

describe("refund path", () => {
  it("create -> fund -> refund", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    expect(isOk(await client.fundEscrow({ jobId, amountUsdc: "100.00" }))).toBe(true);
    const refunded = await client.refund({ jobId });
    expect(isOk(refunded)).toBe(true);
    const job = await client.getJob({ jobId });
    if (!isOk(job)) return;
    expect(job.value.status).toBe("refunded");
  });
});

describe("evaluate-fail path", () => {
  it("evaluated(fail) cannot settle but can refund", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    await client.fundEscrow({ jobId, amountUsdc: "100.00" });
    await client.submitDeliverable({ jobId, deliverableUri: "ipfs://d" });
    const evaluated = await client.evaluate({ jobId, passed: false });
    expect(isOk(evaluated)).toBe(true);
    const job = await client.getJob({ jobId });
    if (!isOk(job)) return;
    expect(job.value.status).toBe("evaluated");
    expect(job.value.evaluation?.passed).toBe(false);

    const settled = await client.settle({ jobId });
    expect(isErr(settled)).toBe(true);
    if (!isErr(settled)) return;
    expect(settled.error.code).toBe("conflict");

    const refunded = await client.refund({ jobId });
    expect(isOk(refunded)).toBe(true);
    const after = await client.getJob({ jobId });
    if (!isOk(after)) return;
    expect(after.value.status).toBe("refunded");
  });
});

describe("illegal-transition rejections", () => {
  it("submit before funded -> conflict", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    const res = await client.submitDeliverable({ jobId, deliverableUri: "ipfs://d" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("conflict");
  });

  it("settle before evaluated -> conflict", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    await client.fundEscrow({ jobId, amountUsdc: "100.00" });
    const res = await client.settle({ jobId });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("conflict");
  });

  it("evaluate before submitted -> conflict", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    await client.fundEscrow({ jobId, amountUsdc: "100.00" });
    const res = await client.evaluate({ jobId, passed: true });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("conflict");
  });

  it("double-fund -> conflict", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    await client.fundEscrow({ jobId, amountUsdc: "100.00" });
    const res = await client.fundEscrow({ jobId, amountUsdc: "100.00" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("conflict");
  });
});

describe("validation rejections", () => {
  it("rejects malformed/non-positive amounts on createJob", async () => {
    const { client } = setup();
    for (const amountUsdc of ["0", "-1", "1.2345678", "abc", ""]) {
      const res = await client.createJob({ ...VALID, amountUsdc });
      expect(isErr(res)).toBe(true);
      if (!isErr(res)) return;
      expect(res.error.code).toBe("validation_error");
    }
  });

  it("rejects empty requester/worker/specUri", async () => {
    const { client } = setup();
    expect(isErr(await client.createJob({ ...VALID, requester: "  " }))).toBe(true);
    expect(isErr(await client.createJob({ ...VALID, worker: "  " }))).toBe(true);
    expect(isErr(await client.createJob({ ...VALID, specUri: "  " }))).toBe(true);
  });

  it("rejects empty jobId on every job-addressed method", async () => {
    const { client } = setup();
    expect(isErr(await client.fundEscrow({ jobId: " ", amountUsdc: "1" }))).toBe(true);
    expect(isErr(await client.submitDeliverable({ jobId: " ", deliverableUri: "x" }))).toBe(true);
    expect(isErr(await client.evaluate({ jobId: " ", passed: true }))).toBe(true);
    expect(isErr(await client.settle({ jobId: " " }))).toBe(true);
    expect(isErr(await client.refund({ jobId: " " }))).toBe(true);
    expect(isErr(await client.getJob({ jobId: " " }))).toBe(true);
  });

  it("rejects an empty scoreOrUri when provided", async () => {
    const { client } = setup();
    const jobId = await createOk(client);
    const res = await client.evaluate({ jobId, passed: true, scoreOrUri: "  " });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });
});

describe("error mapping", () => {
  it("maps a thrown createJob error to a retryable integration_error", async () => {
    const { client } = setup({ throwOn: ["createJob"] });
    const res = await client.createJob(VALID);
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
    expect(res.error.retryable).toBe(true);
  });

  it("maps a thrown fundEscrow error to integration_error", async () => {
    const { client } = setup({ throwOn: ["fundEscrow"] });
    const jobId = await createOk(client);
    const res = await client.fundEscrow({ jobId, amountUsdc: "1" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
  });

  it("maps a thrown getJob error to integration_error", async () => {
    const { client } = setup({ throwOn: ["getJob"] });
    const res = await client.getJob({ jobId: "job_1" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
  });

  it("preserves not_found for an unknown jobId rather than masking it", async () => {
    const { client } = setup();
    const res = await client.getJob({ jobId: "job_999" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("not_found");
  });
});

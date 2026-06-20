# @settlekit/erc8183

ERC-8183 autonomous-agent **job lifecycle** on Arc — create a job, fund a USDC escrow, submit a deliverable, evaluate it, then settle to the worker or refund the requester — wrapped in SettleKit idioms.

ERC-8183 models a unit of agent work as an on-chain job with an escrowed USDC payout. This package wraps that lifecycle with decimal-USDC amounts ([`Money`](../common/src/money.ts)), boundary validation, an explicit state machine, and `Result`-typed outcomes that never throw across the boundary.

## Job state machine

```
            cancel                 cancel
   created ───────► cancelled   funded ───────► cancelled
      │                            │
 fund │                     submit │       refund
      ▼                            ▼      ───────► refunded
   funded ──────────────────► submitted
      │                            │
refund│                  evaluate_ │ evaluate_
      ▼                  pass/fail ▼
  refunded                    evaluated ──────► refunded (refund)
                                   │
                            settle │ (only when evaluation.passed)
                                   ▼
                                settled
```

Happy path: `created → funded → submitted → evaluated → settled`. Terminal states (`settled`, `refunded`, `cancelled`) have no outgoing transitions.

`evaluate` maps **both** a pass and a fail to the single `evaluated` status. The "cannot settle a failed evaluation" rule is therefore enforced by the port (and a fast-fail client pre-check), not by the transition table alone.

## Design: inject the port, take no dependency

Following the `app-kit` / `settlement-core` provider pattern, this package defines the on-chain surface it needs (`Erc8183Port`) and the **consumer injects** an implementation. So `@settlekit/erc8183` depends only on `@settlekit/common` — it never imports a chain SDK, builds offline, and bundles anywhere. The consumer owns viem + Circle Developer-Controlled Wallets (DCW).

### The port the consumer implements

```ts
interface Erc8183Port {
  createJob(p: { requester; worker; amountUsdc; specUri }): Promise<{ jobId; txHash }>;
  fundEscrow(p: { jobId; amountUsdc }): Promise<TxResult>;
  submitDeliverable(p: { jobId; deliverableUri }): Promise<TxResult>;
  evaluate(p: { jobId; passed; scoreOrUri? }): Promise<TxResult>;
  settle(p: { jobId }): Promise<TxResult>;
  refund(p: { jobId }): Promise<TxResult>;
  getJob(p: { jobId }): Promise<Job>;
}
```

## Usage

```ts
import { configureErc8183, type Erc8183Port } from "@settlekit/erc8183";

const port: Erc8183Port = /* viem + Circle DCW implementation, see below */;
const jobs = configureErc8183({ port });

const created = await jobs.createJob({
  requester: "0xreq",
  worker: "0xworker",
  amountUsdc: "100.00",
  specUri: "ipfs://spec",
});
if (!created.ok) throw created.error;
const { jobId } = created.value;

await jobs.fundEscrow({ jobId, amountUsdc: "100.00" });
await jobs.submitDeliverable({ jobId, deliverableUri: "ipfs://deliverable" });
await jobs.evaluate({ jobId, passed: true, scoreOrUri: "0.95" });
const settled = await jobs.settle({ jobId });
if (settled.ok) console.log(settled.value.txHash);
```

Every method returns `Result<T>`. Validation failures surface as `validation_error`, illegal state transitions as `conflict`, missing jobs as `not_found`, and any other thrown port error as a **retryable** `integration_error`. A `SettleKitError` thrown by the port (conflict/not_found) passes through with its code preserved rather than being masked.

## Testing & demos

Inject `LocalErc8183Port` — a deterministic, in-memory port that enforces the state machine, mints sequential `job_N` ids, and returns synthetic monotonically-numbered tx hashes (`0xlocal…`). No chain, no network, no `Date.now`/`Math.random`:

```ts
import { configureErc8183, LocalErc8183Port } from "@settlekit/erc8183";

const port = new LocalErc8183Port(); // or { throwOn: ["createJob"] } to exercise error mapping
const jobs = configureErc8183({ port });
```

## Wiring sketch: viem + Circle Developer-Controlled Wallets

This package does **not** depend on viem — the consumer implements `Erc8183Port` against the ERC-8183 job contract. A typical implementation backs a viem `walletClient` with a Circle DCW signer:

```ts
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { configureErc8183, type Erc8183Port, type Job, type TxResult } from "@settlekit/erc8183";
import { money } from "@settlekit/common";
// import a Circle DCW -> viem account adapter from your own wiring layer

const ERC8183_ABI = [/* createJob / fundEscrow / submitDeliverable / evaluate / settle / refund / jobs(...) */] as const;
const CONTRACT = "0xJobContract" as const;
const USDC_DECIMALS = 6;

const account = /* viem Account backed by a Circle Developer-Controlled Wallet */;
const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) });

async function wait(hash: `0x${string}`): Promise<TxResult> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, status: receipt.status === "success" ? "success" : "failed" };
}

const port: Erc8183Port = {
  async createJob({ requester, worker, amountUsdc, specUri }) {
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ERC8183_ABI,
      functionName: "createJob",
      args: [requester, worker, parseUnits(amountUsdc, USDC_DECIMALS), specUri],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const jobId = decodeJobIdFromLogs(receipt.logs); // contract emits the on-chain job id
    return { jobId, txHash: hash };
  },

  async fundEscrow({ jobId, amountUsdc }) {
    // USDC approve(CONTRACT, amount) first, then:
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ERC8183_ABI,
      functionName: "fundEscrow",
      args: [BigInt(jobId), parseUnits(amountUsdc, USDC_DECIMALS)],
    });
    return wait(hash);
  },

  async submitDeliverable({ jobId, deliverableUri }) {
    const hash = await walletClient.writeContract({
      address: CONTRACT, abi: ERC8183_ABI, functionName: "submitDeliverable",
      args: [BigInt(jobId), deliverableUri],
    });
    return wait(hash);
  },

  async evaluate({ jobId, passed, scoreOrUri }) {
    const hash = await walletClient.writeContract({
      address: CONTRACT, abi: ERC8183_ABI, functionName: "evaluate",
      args: [BigInt(jobId), passed, scoreOrUri ?? ""],
    });
    return wait(hash);
  },

  async settle({ jobId }) {
    const hash = await walletClient.writeContract({
      address: CONTRACT, abi: ERC8183_ABI, functionName: "settle", args: [BigInt(jobId)],
    });
    return wait(hash);
  },

  async refund({ jobId }) {
    const hash = await walletClient.writeContract({
      address: CONTRACT, abi: ERC8183_ABI, functionName: "refund", args: [BigInt(jobId)],
    });
    return wait(hash);
  },

  async getJob({ jobId }): Promise<Job> {
    const raw = await publicClient.readContract({
      address: CONTRACT, abi: ERC8183_ABI, functionName: "jobs", args: [BigInt(jobId)],
    });
    return {
      id: jobId,
      requester: raw.requester,
      worker: raw.worker,
      amount: money(formatUnits(raw.amount, USDC_DECIMALS)),
      status: mapOnchainStatus(raw.status),
      ...(raw.deliverableUri ? { deliverableUri: raw.deliverableUri } : {}),
      ...(raw.hasEvaluation ? { evaluation: { passed: raw.passed, scoreOrUri: raw.scoreOrUri } } : {}),
    };
  },
};

const jobs = configureErc8183({ port });
```

The on-chain contract remains the authority on legal transitions; the SettleKit layer adds validation, a fast-fail pre-check, and uniform `Result` error handling.

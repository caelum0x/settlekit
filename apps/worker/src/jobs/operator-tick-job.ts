/**
 * Operator tick: feeds the autonomous operator from the worker.
 *
 * Each run, for the operator's org:
 *   1. confirmed Arc payments paid into the operator vault that have no
 *      decision yet become `revenue.received` events (payer read from the
 *      USDC transfer on Arc when possible);
 *   2. open bills due within the window get a `bill.due` event;
 *   3. one `tick` event per UTC day (allocate idle inflow, float, yield);
 *   4. pending escalations older than 72h are expired and recorded.
 * Event ids are deterministic, so a decision is never made twice for the
 * same payment, bill or day. Disabled unless a vault is configured or
 * OPERATOR_SIMULATION=1.
 */
import type { Payment } from "@settlekit/common";
import {
  BILL_DUE_WINDOW_MS,
  billDueEvent,
  createOperatorRuntime,
  findDecisionByEventRef,
  operatorEnabled,
  parseUsdc,
  type OperatorEvent,
  type OperatorRuntime,
} from "@settlekit/operator";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

type RuntimeProvider = (ctx: JobContext) => OperatorRuntime | null;

interface Tally {
  readonly processed: number;
  readonly failed: number;
}

const add = (a: Tally, b: Tally): Tally => ({ processed: a.processed + b.processed, failed: a.failed + b.failed });

async function payerOf(ctx: JobContext, payment: Payment, payTo: string): Promise<string> {
  try {
    const verified = await ctx.arc.verifyUsdcTransfer({ txHash: payment.txHash as `0x${string}`, to: payTo as `0x${string}`, minAmount: payment.amount });
    if (verified.confirmed && verified.from) return verified.from;
  } catch (error) {
    ctx.logger.warn("operator: could not read payer from Arc", { paymentId: payment.id, error: errorMessage(error) });
  }
  return `customer:${payment.customerId}`;
}

/** Confirmed Arc payments into the vault, as revenue events. */
async function revenueEvents(ctx: JobContext, rt: OperatorRuntime): Promise<OperatorEvent[]> {
  const orgId = rt.config.orgId;
  const vault = rt.config.vault?.address.toLowerCase();
  const out: OperatorEvent[] = [];
  for (const payment of await ctx.stores.confirmedPayments()) {
    if (payment.organizationId !== orgId || payment.network !== "arc" || !payment.txHash) continue;
    const session = await ctx.stores.getCheckoutSession(payment.checkoutSessionId);
    if (!session) continue;
    if (vault && session.payToAddress.toLowerCase() !== vault) continue;
    const id = `payment:${payment.id}`;
    if (await findDecisionByEventRef(rt.store, orgId, id)) continue;
    out.push({
      type: "revenue.received",
      id,
      orgId,
      at: payment.confirmedAt ?? ctx.now().toISOString(),
      amount: parseUsdc(payment.amount.amount),
      payer: await payerOf(ctx, payment, session.payToAddress),
      paymentRef: payment.txHash,
    });
  }
  return out;
}

async function dueBillEvents(ctx: JobContext, rt: OperatorRuntime): Promise<OperatorEvent[]> {
  const now = ctx.now();
  const orgId = rt.config.orgId;
  const out: OperatorEvent[] = [];
  for (const bill of await rt.store.listBills(orgId, "open")) {
    if (Date.parse(bill.dueAt) - now.getTime() > BILL_DUE_WINDOW_MS) continue;
    const event = billDueEvent(bill, now);
    if (!(await findDecisionByEventRef(rt.store, orgId, event.id))) out.push(event);
  }
  return out;
}

async function dailyTick(ctx: JobContext, rt: OperatorRuntime): Promise<OperatorEvent[]> {
  const now = ctx.now();
  const id = `tick:${now.toISOString().slice(0, 10)}`;
  if (await findDecisionByEventRef(rt.store, rt.config.orgId, id)) return [];
  return [{ type: "tick", id, orgId: rt.config.orgId, at: now.toISOString() }];
}

async function handleAll(ctx: JobContext, rt: OperatorRuntime, events: readonly OperatorEvent[]): Promise<Tally> {
  let tally: Tally = { processed: 0, failed: 0 };
  for (const event of events) {
    try {
      const record = await rt.service.handle(event);
      ctx.logger.info("operator decision", { eventId: event.id, decisionId: record.id, outcome: record.outcome, txHash: record.txHash });
      tally = add(tally, { processed: 1, failed: 0 });
    } catch (error) {
      ctx.logger.error("operator event failed", { eventId: event.id, error: errorMessage(error) });
      tally = add(tally, { processed: 0, failed: 1 });
    }
  }
  return tally;
}

export function createOperatorTickJob(provider: RuntimeProvider): Job {
  return {
    name: "operator-tick",
    async run(ctx: JobContext): Promise<JobResult> {
      const rt = provider(ctx);
      if (!rt) return { processed: 0, failed: 0 };
      let tally: Tally = { processed: 0, failed: 0 };
      try {
        const expired = await rt.service.expireStale(rt.config.orgId);
        tally = add(tally, { processed: expired.length, failed: 0 });
      } catch (error) {
        ctx.logger.error("operator escalation expiry failed", { error: errorMessage(error) });
        tally = add(tally, { processed: 0, failed: 1 });
      }
      const events = [...(await revenueEvents(ctx, rt)), ...(await dueBillEvents(ctx, rt)), ...(await dailyTick(ctx, rt))];
      return add(tally, await handleAll(ctx, rt, events));
    },
  };
}

let shared: OperatorRuntime | null = null;

/** Env-built runtime, created once; null when the operator is not enabled. */
function envRuntime(ctx: JobContext): OperatorRuntime | null {
  if (!operatorEnabled(process.env)) return null;
  if (!shared) {
    shared = createOperatorRuntime(process.env, DEFAULT_ORG_ID, {
      now: ctx.now,
      onError: (context, error) => ctx.logger.error("operator", { context, error: errorMessage(error) }),
    });
  }
  return shared;
}

export const operatorTickJob: Job = createOperatorTickJob(envRuntime);

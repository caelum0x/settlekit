/**
 * The stream meter's data layer.
 *
 * This is NOT mocked JSON — it drives the real streaming-payment domain logic
 * (@settlekit/streaming) so the UI shows exactly what the spine produces:
 *
 *  - every stream is opened with `openStream({ ... })`, the real rate/accrual
 *    entry point. Accrual is never recomputed by hand here;
 *  - each stream is advanced over a FIXED millisecond clock (a mutable cursor),
 *    `reportFlow(false/true)` is called at the proof-of-flow drop windows so a
 *    delivery gap is genuinely not billed, and `settle(sink)` is awaited at
 *    checkpoint intervals to capture the real `StreamSettlement` batches;
 *  - the per-stream meter values come straight from `stream.snapshot()`, and the
 *    serializable projection comes from `recordFromStream()` — the same
 *    doc-projection the persistence layer uses.
 *
 * A fixed clock makes the dataset fully deterministic across renders and across
 * `next build` prerenders (no `Date.now()`/`new Date()` on the server path).
 * The browser meter (components/LiveMeter.tsx) constructs the SAME real
 * `PaymentStream` via `buildLiveStream(() => Date.now())`, so the on-screen
 * ticker is the genuine accrual function with a wall clock.
 *
 * Swap this module for a `StreamStore`-backed loader to go live.
 */

import { type Money, type PaymentNetwork, addMoney, money } from "@settlekit/common";
import {
  type OpenStreamInput,
  type StreamRecord,
  type StreamSettlement,
  type StreamSnapshot,
  PaymentStream,
  openStream,
  recordFromStream,
} from "@settlekit/streaming";

/* -------------------------------------------------------------------------- */
/* Fixed clock                                                                 */
/* -------------------------------------------------------------------------- */

/** Epoch ms of the deterministic build/SSR clock origin. */
export const FIXED_CLOCK_MS = Date.parse("2026-06-18T09:00:00.000Z");

/** Network used by the Lepton nanopayment lane. */
const NETWORK: PaymentNetwork = "arc";

/* -------------------------------------------------------------------------- */
/* Seeds: Owncast broadcasts + Navidrome listens                              */
/* -------------------------------------------------------------------------- */

export type StreamKind = "owncast" | "navidrome";

/** A flow drop: delivery pauses at `atSecond` for `forSeconds` (not billed). */
export interface FlowDrop {
  atSecond: number;
  forSeconds: number;
}

export interface StreamSeed {
  id: string;
  kind: StreamKind;
  /** Payer (viewer/listener) address. */
  payer: string;
  /** Payee (streamer/artist) address. */
  payee: string;
  /** Authorized rate, decimal USDC per second (<= 6 dp). */
  ratePerSecondUsdc: string;
  /** Maximum total committed up front, decimal USDC (<= 6 dp). */
  reserveUsdc: string;
  /** How many seconds of the stream were consumed. */
  watchedSeconds: number;
  /** Delivery drops within the watched window (proof-of-flow pauses). */
  flowDrops?: FlowDrop[];
  /** Number of equal settlement checkpoints to capture across the window. */
  checkpoints: number;
}

/** All seeded streams. */
export const SEEDS: readonly StreamSeed[] = [
  {
    id: "pst_owncast_keynote",
    kind: "owncast",
    payer: "0xv1ewer00000000000000000000000000000000a1",
    payee: "0x57reamer000000000000000000000000000000b2",
    ratePerSecondUsdc: "0.0002",
    reserveUsdc: "0.5",
    watchedSeconds: 900,
    flowDrops: [{ atSecond: 300, forSeconds: 45 }],
    checkpoints: 3,
  },
  {
    id: "pst_navidrome_album",
    kind: "navidrome",
    payer: "0xl15tener0000000000000000000000000000a3c",
    payee: "0xart15t00000000000000000000000000000000d4",
    ratePerSecondUsdc: "0.0001",
    reserveUsdc: "0.1",
    watchedSeconds: 480,
    flowDrops: [{ atSecond: 120, forSeconds: 20 }],
    checkpoints: 2,
  },
  {
    id: "pst_owncast_workshop",
    kind: "owncast",
    payer: "0xv1ewer00000000000000000000000000000000e5",
    payee: "0x57reamer000000000000000000000000000000f6",
    ratePerSecondUsdc: "0.00015",
    reserveUsdc: "0.3",
    watchedSeconds: 600,
    checkpoints: 2,
  },
];

/** The single stream the client meter animates live. */
export const LIVE_SEED: StreamSeed = SEEDS[0];

/* -------------------------------------------------------------------------- */
/* Building a real PaymentStream                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a real `PaymentStream` for a seed with a caller-supplied clock.
 *
 * Used by the client `LiveMeter` with `() => Date.now()` so the live ticker is
 * the genuine accrual function rather than a re-implemented formula. Note this
 * builds a *freshly opened* stream — it does not replay the historical flow
 * drops/settlements (those belong to the deterministic server projection).
 */
export function buildLiveStream(seed: StreamSeed, now: () => number): PaymentStream {
  const input: OpenStreamInput = {
    id: seed.id,
    payer: seed.payer,
    payee: seed.payee,
    network: NETWORK,
    ratePerSecondUsdc: seed.ratePerSecondUsdc,
    reserveUsdc: seed.reserveUsdc,
    now,
  };
  return openStream(input);
}

/**
 * Drive a seed deterministically over the fixed clock: advance a cursor in
 * one-second steps, apply proof-of-flow drops as `reportFlow` pauses, and
 * `settle()` at evenly spaced checkpoints. Returns the live stream plus the
 * captured settlement batches.
 */
async function driveSeed(
  seed: StreamSeed,
): Promise<{ stream: PaymentStream; settlements: StreamSettlement[] }> {
  validateSeed(seed);

  // Mutable cursor over the fixed clock. The stream reads `now()` lazily on
  // every metered call, so advancing the cursor *is* the passage of time.
  let cursorMs = FIXED_CLOCK_MS;
  const now = (): number => cursorMs;
  const stream = buildLiveStream(seed, now);

  // Pre-compute the absolute seconds at which delivery drops begin/end.
  const dropStart = new Map<number, number>(); // second -> forSeconds
  const dropEnd = new Set<number>();
  for (const drop of seed.flowDrops ?? []) {
    dropStart.set(drop.atSecond, drop.forSeconds);
    dropEnd.add(drop.atSecond + drop.forSeconds);
  }

  const settlements: StreamSettlement[] = [];
  const sink = (s: StreamSettlement): void => {
    settlements.push(s);
  };

  const interval =
    seed.checkpoints > 0 ? Math.max(1, Math.floor(seed.watchedSeconds / seed.checkpoints)) : 0;

  for (let second = 1; second <= seed.watchedSeconds; second++) {
    cursorMs += 1000;

    // Delivery drop begins: pause the meter via proof-of-flow.
    if (dropStart.has(second)) {
      stream.reportFlow(false);
    }
    // Delivery resumes: resume the flow-paused meter.
    if (dropEnd.has(second)) {
      stream.reportFlow(true);
    }

    // Capture a settlement checkpoint at evenly spaced intervals.
    if (interval > 0 && second % interval === 0) {
      await stream.settle(sink);
    }
  }

  return { stream, settlements };
}

function validateSeed(seed: StreamSeed): void {
  // money()/toBaseUnits throw RangeError on >6 dp or malformed strings; fail
  // fast at the boundary with a clear message.
  try {
    money(seed.ratePerSecondUsdc);
    money(seed.reserveUsdc);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "invalid amount";
    throw new Error(`Invalid seed ${seed.id}: ${detail}`);
  }
  if (!Number.isInteger(seed.watchedSeconds) || seed.watchedSeconds < 0) {
    throw new Error(`Invalid seed ${seed.id}: watchedSeconds must be a non-negative integer`);
  }
  if (!Number.isInteger(seed.checkpoints) || seed.checkpoints < 0) {
    throw new Error(`Invalid seed ${seed.id}: checkpoints must be a non-negative integer`);
  }
}

/* -------------------------------------------------------------------------- */
/* Views + aggregation                                                         */
/* -------------------------------------------------------------------------- */

export interface StreamView {
  id: string;
  kind: StreamKind;
  payer: string;
  payee: string;
  network: PaymentNetwork;
  ratePerSecondUsdc: string;
  snapshot: StreamSnapshot;
  /** Serializable doc-projection (persistence/doc-projection pattern). */
  record: StreamRecord;
}

export interface SettlementView {
  streamId: string;
  kind: StreamKind;
  /** This batch's amount (decimal USDC string). */
  amount: string;
  /** Cumulative settled total after this batch (decimal USDC string). */
  settledTotal: string;
  at: string;
}

export interface MeterTotals {
  activeStreams: number;
  accrued: Money;
  settled: Money;
  due: Money;
  refundable: Money;
}

export interface MeterContext {
  streams: StreamView[];
  settlements: SettlementView[];
  totals: MeterTotals;
}

function sum(amounts: Money[]): Money {
  return amounts.reduce<Money>((acc, m) => addMoney(acc, m), money("0"));
}

/**
 * Build the full meter context from the real domain logic. Async because
 * `settle()` is async. Deterministic: every clock read comes from the fixed
 * cursor, so two calls produce identical results.
 */
export async function getMeterContext(): Promise<MeterContext> {
  // Drive every seed (sequentially keeps the fixed-clock projection trivially
  // deterministic and avoids any shared-cursor interleaving).
  const driven: { seed: StreamSeed; stream: PaymentStream; settlements: StreamSettlement[] }[] = [];
  for (const seed of SEEDS) {
    const { stream, settlements } = await driveSeed(seed);
    driven.push({ seed, stream, settlements });
  }

  const recordAt = new Date(FIXED_CLOCK_MS);

  const streams: StreamView[] = driven.map(({ seed, stream }) => {
    const snapshot = stream.snapshot();
    return {
      id: seed.id,
      kind: seed.kind,
      payer: seed.payer,
      payee: seed.payee,
      network: NETWORK,
      ratePerSecondUsdc: snapshot.ratePerSecondUsdc,
      snapshot,
      record: recordFromStream(stream, recordAt),
    };
  });

  const kindById = new Map<string, StreamKind>(driven.map(({ seed }) => [seed.id, seed.kind]));

  const settlements: SettlementView[] = driven
    .flatMap(({ settlements: batches }) => batches)
    .map((s) => ({
      streamId: s.streamId,
      kind: kindById.get(s.streamId) ?? "owncast",
      amount: s.amount.amount,
      settledTotal: s.settledTotal.amount,
      at: s.at,
    }));

  const totals: MeterTotals = {
    activeStreams: streams.length,
    accrued: sum(streams.map((s) => money(s.snapshot.accruedUsdc))),
    settled: sum(streams.map((s) => money(s.snapshot.settledUsdc))),
    due: sum(streams.map((s) => money(s.snapshot.dueUsdc))),
    refundable: sum(streams.map((s) => money(s.snapshot.refundableUsdc))),
  };

  return { streams, settlements, totals };
}

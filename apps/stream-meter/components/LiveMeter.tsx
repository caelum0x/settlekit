"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentStream, StreamSettlement, StreamSnapshot } from "@settlekit/streaming";
import { buildLiveStream, LIVE_SEED } from "@/lib/data";
import { formatDateTime, formatUsdc, shortWallet } from "@/lib/format";
import { StatusBadge } from "@/components/ui";

const TICK_MS = 200;

interface LiveMeterProps {
  ratePerSecondUsdc: string;
  reserveUsdc: string;
  payer: string;
  payee: string;
}

/**
 * The live, ticking per-second meter.
 *
 * On mount it constructs the SAME real `PaymentStream` the server projection
 * uses (`buildLiveStream(LIVE_SEED, () => Date.now())`) — accrual is the genuine
 * domain function with a wall clock, never a hand-rolled formula. A ~200ms
 * interval bumps a re-render token; every render reads `stream.snapshot()` for
 * the displayed values. The stream is constructed once (lazy ref) so re-renders
 * never reset the meter, and the interval is cleared on unmount (React
 * StrictMode double-invokes effects in dev — clearing avoids a double-speed
 * meter).
 */
export function LiveMeter({ ratePerSecondUsdc, reserveUsdc, payer, payee }: LiveMeterProps) {
  // Construct the real stream exactly once.
  const streamRef = useRef<PaymentStream | null>(null);
  if (streamRef.current === null) {
    streamRef.current = buildLiveStream(LIVE_SEED, () => Date.now());
  }
  const stream = streamRef.current;

  // Re-render token + locally captured settlement checkpoints.
  const [, setTick] = useState(0);
  const [checkpoints, setCheckpoints] = useState<StreamSettlement[]>([]);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    const handle = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const snapshot: StreamSnapshot = stream.snapshot();
  const delivering = snapshot.state === "active";
  const flowPaused = snapshot.state === "paused" && snapshot.pauseReason === "flow";

  function toggleDelivery(): void {
    // Proof-of-flow: simulate a delivery drop / resume.
    stream.reportFlow(!delivering);
    setTick((t) => t + 1);
  }

  function togglePause(): void {
    if (snapshot.state === "active") {
      stream.pause();
    } else if (snapshot.state === "paused") {
      stream.resume();
    }
    setTick((t) => t + 1);
  }

  async function settleNow(): Promise<void> {
    if (settling) return;
    setSettling(true);
    try {
      const settlement = await stream.settle();
      setCheckpoints((prev) => [settlement, ...prev]);
    } finally {
      setSettling(false);
      setTick((t) => t + 1);
    }
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2 className="card-title">Live meter · {LIVE_SEED.kind === "owncast" ? "Owncast broadcast" : "Navidrome listen"}</h2>
        <StatusBadge status={snapshot.state} />
      </div>

      <p className="page-desc">
        <span className="mono">{shortWallet(payer)}</span> →{" "}
        <span className="mono">{shortWallet(payee)}</span> · rate{" "}
        <span className="mono">{formatUsdc(ratePerSecondUsdc)}/s</span> · reserve{" "}
        <span className="mono">{formatUsdc(reserveUsdc)}</span>
      </p>

      <div className="stat-grid">
        <div className="stat-card tone-good">
          <div className="stat-label">Accrued</div>
          <div className="stat-value mono">{formatUsdc(snapshot.accruedUsdc)}</div>
          <div className="stat-hint">{delivering ? "Ticking…" : flowPaused ? "Flow dropped" : "Paused"}</div>
        </div>
        <div className="stat-card tone-warn">
          <div className="stat-label">Due (unsettled)</div>
          <div className="stat-value mono">{formatUsdc(snapshot.dueUsdc)}</div>
          <div className="stat-hint">Next checkpoint</div>
        </div>
        <div className="stat-card tone-good">
          <div className="stat-label">Settled</div>
          <div className="stat-value mono">{formatUsdc(snapshot.settledUsdc)}</div>
          <div className="stat-hint">{checkpoints.length} checkpoints</div>
        </div>
        <div className="stat-card tone-default">
          <div className="stat-label">Refundable reserve</div>
          <div className="stat-value mono">{formatUsdc(snapshot.refundableUsdc)}</div>
          <div className="stat-hint">Unused, refunded on stop</div>
        </div>
      </div>

      <div className="row-between" style={{ marginTop: "1rem", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={toggleDelivery}>
          {delivering ? "Drop delivery (flow off)" : "Resume delivery (flow on)"}
        </button>
        <button type="button" className="btn" onClick={togglePause}>
          {snapshot.state === "active" ? "Pause (manual)" : "Resume (manual)"}
        </button>
        <button type="button" className="btn btn-primary" onClick={settleNow} disabled={settling}>
          {settling ? "Settling…" : "Settle now"}
        </button>
      </div>

      {checkpoints.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: "1rem" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th className="ta-right">Batch amount</th>
                <th className="ta-right">Settled total</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((c, i) => (
                <tr key={`${c.at}-${i}`}>
                  <td className="mono">{formatDateTime(c.at)}</td>
                  <td className="ta-right mono">{formatUsdc(c.amount.amount)}</td>
                  <td className="ta-right mono">{formatUsdc(c.settledTotal.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

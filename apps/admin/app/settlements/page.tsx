import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney, formatRelative } from "@/lib/format";
import type { SettlementStatus } from "@/lib/types";
import { Pill, EmptyRow } from "../components/ui";

export const dynamic = "force-dynamic";

/**
 * statusTone() has no cases for `settled` / `submitted` (they fall through to
 * `muted`), so a local map is used with <Pill> rather than <Badge> — mirroring
 * the risk page's REVIEW_TONE — to avoid touching the shared helper.
 */
const SETTLEMENT_TONE: Record<SettlementStatus, "ok" | "warn" | "danger" | "muted"> = {
  settled: "ok",
  submitted: "warn",
  pending: "muted",
  failed: "danger",
};

/** Shorten a tx hash to a 0x-prefixed head…tail for the table cell. */
function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export default async function SettlementsPage() {
  let settlements;
  try {
    settlements = await api.settlements();
  } catch (e) {
    return (
      <>
        <h1>Settlements</h1>
        <div className="error">
          Failed to load settlements:{" "}
          {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Settlements</h1>
      <p className="subtitle">
        Merchant payouts settled to external wallets. Each row tracks the
        on-chain network, settlement reference, and transaction hash.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Settlement</th>
              <th>Org</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Network</th>
              <th>Reference</th>
              <th>Tx hash</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 ? (
              <EmptyRow colSpan={8} text="No settlements." />
            ) : (
              settlements.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>
                    <Link href={`/organizations/${s.organizationId}`}>
                      {s.organizationId}
                    </Link>
                  </td>
                  <td>
                    <Pill label={s.status} tone={SETTLEMENT_TONE[s.status]} />
                  </td>
                  <td>{formatMoney(s.amount)}</td>
                  <td>{s.network}</td>
                  <td className="mono">{s.reference}</td>
                  <td className="mono">{s.txHash ? shortHash(s.txHash) : "—"}</td>
                  <td>{formatRelative(s.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

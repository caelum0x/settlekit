import type { Metadata } from "next";
import { API_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Proof of payments — SettleKit",
  description: "Live, verifiable list of payments settled through SettleKit on every chain, with explorer links.",
};

// Re-read the API every 30 seconds.
export const revalidate = 30;

type Env = "mainnet" | "testnet";
type Source = "checkout" | "agent_x402" | "agent_mpp" | "direct";

interface ProofPayment {
  network: string;
  networkName: string;
  env: Env;
  asset: string;
  amountUsd: string;
  txHash: string;
  explorerUrl: string | null;
  confirmedAt: string;
  source: Source;
}

interface ProofReport {
  generatedAt: string;
  payments: ProofPayment[];
  totals: { network: string; networkName: string; env: Env; asset: string; count: number; volumeUsd: string }[];
  mainnet: { count: number; volumeUsd: string };
  testnet: { count: number; volumeUsd: string };
  agentPurchases: number;
}

async function loadProof(): Promise<{ report: ProofReport | null; error: string | null }> {
  try {
    const res = await fetch(`${API_URL}/v1/public/proof`, { next: { revalidate: 30 } });
    if (!res.ok) return { report: null, error: `API responded ${res.status}` };
    const body = (await res.json()) as { data?: ProofReport };
    return body.data ? { report: body.data, error: null } : { report: null, error: "Empty response" };
  } catch (err) {
    return { report: null, error: err instanceof Error ? err.message : "API unreachable" };
  }
}

const SOURCE_LABEL: Record<Source, string> = {
  checkout: "Checkout",
  agent_x402: "AI agent · x402",
  agent_mpp: "AI agent · MPP",
  direct: "Direct",
};

function usd(value: string): string {
  const n = Number(value);
  return Number.isNaN(n) ? value : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function short(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : hash;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export default async function ProofPage() {
  const { report, error } = await loadProof();

  return (
    <>
      <section className="section page-hero">
        <div className="container">
          <div className="ref">
            <span className="ref-no">§ 00</span>
            <span>Proof</span>
            <span className="ref-fill" aria-hidden="true" />
          </div>
          <div className="section-head">
            <h1 className="section-title">Every payment, on-chain and checkable</h1>
            <p className="section-desc">
              Confirmed payments settled through SettleKit, newest first. Each one links to its transaction on the
              chain&apos;s explorer. Testnet payments are labelled as testnet and never counted as mainnet volume. Demo
              and test accounts are excluded.
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          {!report ? (
            <div className="proof-empty">Live data is unavailable right now ({error}). Please check back shortly.</div>
          ) : (
            <>
              <div className="proof-stats">
                <div className="proof-stat">
                  <span className="proof-stat-label">Mainnet volume</span>
                  <span className="proof-stat-value">{usd(report.mainnet.volumeUsd)}</span>
                  <span className="proof-stat-hint">{report.mainnet.count} payments</span>
                </div>
                <div className="proof-stat">
                  <span className="proof-stat-label">Testnet volume</span>
                  <span className="proof-stat-value">{usd(report.testnet.volumeUsd)}</span>
                  <span className="proof-stat-hint">{report.testnet.count} payments, not real money</span>
                </div>
                <div className="proof-stat">
                  <span className="proof-stat-label">AI agent purchases</span>
                  <span className="proof-stat-value">{report.agentPurchases}</span>
                  <span className="proof-stat-hint">x402 and MPP</span>
                </div>
              </div>

              {report.totals.length > 0 ? (
                <div className="proof-totals">
                  {report.totals.map((t) => (
                    <div key={`${t.network}-${t.env}`} className="proof-total">
                      <span className="proof-total-name">
                        {t.networkName}
                        {t.env === "testnet" ? <span className="proof-testnet">testnet</span> : null}
                      </span>
                      <span className="proof-total-value">
                        {usd(t.volumeUsd)} <small>{t.asset} · {t.count}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {report.payments.length === 0 ? (
                <div className="proof-empty">No confirmed payments yet. The first one will appear here within a minute.</div>
              ) : (
                <div className="proof-table-wrap">
                  <table className="proof-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Network</th>
                        <th>Asset</th>
                        <th>Buyer</th>
                        <th>Transaction</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.payments.map((p) => (
                        <tr key={p.txHash}>
                          <td>{when(p.confirmedAt)}</td>
                          <td>
                            {p.networkName}
                            {p.env === "testnet" ? <span className="proof-testnet">testnet</span> : null}
                          </td>
                          <td className="mono">{p.asset}</td>
                          <td>
                            <span className={p.source.startsWith("agent") ? "proof-agent" : ""}>{SOURCE_LABEL[p.source]}</span>
                          </td>
                          <td className="mono">
                            {p.explorerUrl ? (
                              <a className="text-link" href={p.explorerUrl} target="_blank" rel="noreferrer">
                                {short(p.txHash)}
                              </a>
                            ) : (
                              short(p.txHash)
                            )}
                          </td>
                          <td className="num">{usd(p.amountUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="proof-note">Updated {when(report.generatedAt)}. Amounts are the USD price charged; Zcash payments settle the equivalent ZEC at a locked quote.</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}

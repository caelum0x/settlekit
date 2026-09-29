/**
 * Public proof of settlement: recent confirmed payments across every seller,
 * with network, asset, amount, explorer link and time, plus totals per
 * network. Agent purchases (x402 / MPP) are labelled. Payments of demo/test
 * organizations are excluded (the bootstrap org, orgs flagged `testAccount`,
 * and any id in PROOF_EXCLUDED_ORGS). Testnet payments stay visible but are
 * labelled testnet — nothing is presented as mainnet volume unless it is.
 *
 * No buyer or seller identity is exposed: only on-chain facts anyone could
 * read from the explorer link.
 */
import type { Payment, PaymentNetwork } from "@settlekit/common";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppContext } from "../context.js";
import { explorerTxUrl, networkInfo } from "./network-catalog.js";
import { paymentSource, type PaymentSource } from "./payment-views.js";

export interface ProofPayment {
  network: PaymentNetwork;
  networkName: string;
  env: "mainnet" | "testnet";
  asset: string;
  amountUsd: string;
  txHash: string;
  explorerUrl: string | null;
  confirmedAt: string;
  source: PaymentSource;
}

export interface ProofTotals {
  network: PaymentNetwork;
  networkName: string;
  env: "mainnet" | "testnet";
  asset: string;
  count: number;
  volumeUsd: string;
}

export interface ProofReport {
  generatedAt: string;
  payments: ProofPayment[];
  totals: ProofTotals[];
  mainnet: { count: number; volumeUsd: string };
  testnet: { count: number; volumeUsd: string };
  agentPurchases: number;
}

const SCAN_LIMIT = 2_000;
const SHOW_LIMIT = 100;
const CACHE_MS = 30_000;

let cache: { at: number; report: ProofReport } | null = null;

function excludedOrgs(): Set<string> {
  const extra = (process.env.PROOF_EXCLUDED_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([DEFAULT_ORG_ID, ...extra]);
}

/** Sum decimal USD strings exactly (6 dp, bigint). */
function addUsd(a: string, b: string): string {
  const toMicros = (v: string): bigint => {
    const [whole = "0", frac = ""] = v.split(".");
    return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  };
  const total = toMicros(a) + toMicros(b);
  const cents = (total % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${total / 1_000_000n}.${cents}`;
}

async function isTestOrg(ctx: AppContext, organizationId: string, memo: Map<string, Promise<boolean>>): Promise<boolean> {
  let hit = memo.get(organizationId);
  if (!hit) {
    hit = ctx.orgSettings.get(organizationId).then((s) => s.testAccount === true);
    memo.set(organizationId, hit);
  }
  return hit;
}

async function confirmedPayments(ctx: AppContext): Promise<Payment[]> {
  if (ctx.payments.listRecentConfirmed) return ctx.payments.listRecentConfirmed(SCAN_LIMIT);
  return [];
}

export async function buildProof(ctx: AppContext): Promise<ProofReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;
  const excluded = excludedOrgs();
  const memo = new Map<string, Promise<boolean>>();
  const rows: ProofPayment[] = [];
  for (const payment of await confirmedPayments(ctx)) {
    if (!payment.txHash || excluded.has(payment.organizationId)) continue;
    if (await isTestOrg(ctx, payment.organizationId, memo)) continue;
    const info = networkInfo(payment.network);
    rows.push({
      network: payment.network,
      networkName: info?.name ?? payment.network,
      env: info?.env ?? "mainnet",
      asset: info?.asset ?? payment.amount.currency,
      amountUsd: payment.amount.amount,
      txHash: payment.txHash,
      explorerUrl: explorerTxUrl(payment.network, payment.txHash),
      confirmedAt: payment.confirmedAt ?? payment.createdAt,
      source: paymentSource(payment),
    });
  }

  const byKey = new Map<string, ProofTotals>();
  const sums = { mainnet: { count: 0, volumeUsd: "0.00" }, testnet: { count: 0, volumeUsd: "0.00" } };
  for (const row of rows) {
    const key = `${row.network}:${row.env}`;
    const prev = byKey.get(key) ?? {
      network: row.network,
      networkName: row.networkName,
      env: row.env,
      asset: row.asset,
      count: 0,
      volumeUsd: "0.00",
    };
    byKey.set(key, { ...prev, count: prev.count + 1, volumeUsd: addUsd(prev.volumeUsd, row.amountUsd) });
    sums[row.env] = { count: sums[row.env].count + 1, volumeUsd: addUsd(sums[row.env].volumeUsd, row.amountUsd) };
  }

  const report: ProofReport = {
    generatedAt: new Date().toISOString(),
    payments: rows.slice(0, SHOW_LIMIT),
    totals: [...byKey.values()].sort((a, b) => b.count - a.count),
    mainnet: sums.mainnet,
    testnet: sums.testnet,
    agentPurchases: rows.filter((r) => r.source === "agent_x402" || r.source === "agent_mpp").length,
  };
  cache = { at: Date.now(), report };
  return report;
}

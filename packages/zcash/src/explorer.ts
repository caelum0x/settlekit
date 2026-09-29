/**
 * Zcash transparent chain reads behind a small interface, with a Blockchair
 * implementation (https://api.blockchair.com/zcash — keyless tier 1000
 * requests/day, 30/min; mainnet only).
 *
 * Rate-limit and quota responses (HTTP 402, 429, 435) are surfaced as
 * `retryLater`; they are NEVER interpreted as a missing or paid transaction.
 */

import type { FetchLike } from "./quote.js";

export interface ZcashTxOutput {
  recipient: string | null;
  /** Zatoshis. */
  value: bigint;
}

export interface ZcashTransaction {
  txid: string;
  /** Block height, or null while in the mempool. */
  blockHeight: number | null;
  /** Block time (UTC), or null while unmined. */
  blockTime: Date | null;
  confirmations: number;
  outputs: ZcashTxOutput[];
  /** Transparent input addresses (payer candidates). */
  inputAddresses: string[];
}

export interface ZcashAddressActivity {
  txid: string;
  blockHeight: number | null;
  blockTime: Date | null;
  /** Net zatoshi change for the address in this tx. */
  balanceChange: bigint;
}

export type ExplorerResult<T> =
  | { ok: true; value: T }
  | { ok: false; retryLater: boolean; status: number; reason: string };

export interface ZcashExplorer {
  /** The transaction, or `null` value when the explorer does not know it. */
  getTransaction(txid: string): Promise<ExplorerResult<ZcashTransaction | null>>;
  /** Recent activity for a transparent address, newest first. */
  getAddressActivity(address: string, limit: number): Promise<ExplorerResult<ZcashAddressActivity[]>>;
}

export const BLOCKCHAIR_ZCASH_URL = "https://api.blockchair.com/zcash";
const RETRY_LATER_STATUSES = new Set([402, 429, 430, 435, 503]);

export interface BlockchairOptions {
  fetch: FetchLike;
  baseUrl?: string;
  apiKey?: string;
}

interface BlockchairContext {
  code?: number;
  state?: number;
  error?: string;
}

/** Blockchair renders times as "YYYY-MM-DD HH:MM:SS" in UTC. */
function parseTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function height(value: unknown): number | null {
  return typeof value === "number" && value >= 0 ? value : null;
}

function confirmationsAt(tip: number | undefined, blockHeight: number | null): number {
  if (tip === undefined || blockHeight === null || tip < blockHeight) return 0;
  return tip - blockHeight + 1;
}

function zats(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`unexpected Blockchair amount: ${String(value)}`);
}

/** Create a {@link ZcashExplorer} backed by the Blockchair REST API. */
export function createBlockchairExplorer(options: BlockchairOptions): ZcashExplorer {
  const base = (options.baseUrl ?? BLOCKCHAIR_ZCASH_URL).replace(/\/+$/, "");

  async function request(path: string, query: Record<string, string> = {}): Promise<ExplorerResult<{
    data: unknown;
    context: BlockchairContext;
  }>> {
    const params = new URLSearchParams({ ...query, ...(options.apiKey ? { key: options.apiKey } : {}) });
    const qs = params.toString();
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await options.fetch(`${base}${path}${qs ? `?${qs}` : ""}`);
    } catch (error) {
      return { ok: false, retryLater: true, status: 0, reason: `explorer unreachable: ${String(error)}` };
    }
    if (!res.ok) {
      const retryLater = RETRY_LATER_STATUSES.has(res.status) || res.status >= 500;
      return { ok: false, retryLater, status: res.status, reason: `explorer responded HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data?: unknown; context?: BlockchairContext };
    return { ok: true, value: { data: body.data, context: body.context ?? {} } };
  }

  return {
    async getTransaction(txid) {
      const result = await request(`/dashboards/transaction/${encodeURIComponent(txid)}`);
      if (!result.ok) return result;
      const { data, context } = result.value;
      const entry = data && !Array.isArray(data) ? (data as Record<string, unknown>)[txid] : undefined;
      if (entry === undefined) return { ok: true, value: null };
      const record = entry as {
        transaction: { hash: string; block_id: unknown; time: unknown };
        inputs: Array<{ recipient?: unknown }>;
        outputs: Array<{ recipient?: unknown; value: unknown }>;
      };
      const blockHeight = height(record.transaction.block_id);
      return {
        ok: true,
        value: {
          txid: record.transaction.hash,
          blockHeight,
          blockTime: blockHeight === null ? null : parseTime(record.transaction.time),
          confirmations: confirmationsAt(context.state, blockHeight),
          outputs: record.outputs.map((output) => ({
            recipient: typeof output.recipient === "string" ? output.recipient : null,
            value: zats(output.value),
          })),
          inputAddresses: record.inputs.flatMap((input) =>
            typeof input.recipient === "string" ? [input.recipient] : [],
          ),
        },
      };
    },

    async getAddressActivity(address, limit) {
      const result = await request(`/dashboards/address/${encodeURIComponent(address)}`, {
        transaction_details: "true",
        limit: String(limit),
      });
      if (!result.ok) return result;
      const { data } = result.value;
      const entry = data && !Array.isArray(data) ? (data as Record<string, unknown>)[address] : undefined;
      const transactions = (entry as { transactions?: unknown[] } | undefined)?.transactions ?? [];
      return {
        ok: true,
        value: transactions.map((raw) => {
          const tx = raw as { hash: string; block_id: unknown; time: unknown; balance_change: unknown };
          const blockHeight = height(tx.block_id);
          return {
            txid: tx.hash,
            blockHeight,
            blockTime: blockHeight === null ? null : parseTime(tx.time),
            balanceChange: zats(tx.balance_change),
          };
        }),
      };
    },
  };
}

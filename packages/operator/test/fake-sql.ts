import type { SqlClient } from "../src/pg-store.js";

type Row = Record<string, unknown>;

/**
 * A tiny in-memory interpreter for exactly the SQL shapes PgOperatorStore
 * emits. Stores rows per table, enforces primary keys and UNIQUE (org_id, seq),
 * and returns `metadata` as parsed jsonb, like postgres.js does.
 */
export class FakeSql implements SqlClient {
  readonly statements: string[] = [];
  private readonly tables = new Map<string, Row[]>();
  failNext: Error | null = null;

  async unsafe(query: string, params: unknown[] = []): Promise<Row[]> {
    this.statements.push(query);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const q = query.replace(/\s+/g, " ").trim();
    if (/^CREATE /.test(q)) {
      const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(q)?.[1];
      if (table && !this.tables.has(table)) this.tables.set(table, []);
      return [];
    }
    if (q.startsWith("INSERT INTO")) return this.insert(q, params);
    if (q.startsWith("SELECT")) return this.select(q, params);
    if (q.startsWith("DELETE FROM")) {
      const table = /DELETE FROM (\w+)/.exec(q)?.[1] ?? "";
      const rows = this.rows(table);
      this.tables.set(table, rows.filter((r) => !(r.org_id === params[0] && r.id === params[1])));
      return [];
    }
    throw new Error(`FakeSql cannot run: ${q}`);
  }

  private rows(table: string): Row[] {
    const rows = this.tables.get(table);
    if (!rows) throw new Error(`relation "${table}" does not exist`);
    return rows;
  }

  private insert(q: string, params: unknown[]): Row[] {
    const [, table = "", cols = ""] = /INSERT INTO (\w+) \(([^)]+)\)/.exec(q) ?? [];
    const names = cols.split(",").map((c) => c.trim());
    const row: Row = Object.fromEntries(names.map((n, i) => [n, n === "metadata" ? JSON.parse(String(params[i])) : params[i]]));
    const rows = this.rows(table);
    const existing = rows.findIndex((r) => r.id === row.id);
    if (existing >= 0) {
      if (!q.includes("ON CONFLICT")) throw new Error("duplicate key value violates unique constraint");
      if (q.includes("DO NOTHING")) return [];
      rows[existing] = { ...rows[existing], ...row };
      return [];
    }
    if ("seq" in row && rows.some((r) => r.org_id === row.org_id && r.seq === row.seq)) {
      throw new Error("duplicate key value violates unique constraint operator_decisions_org_id_seq_key");
    }
    rows.push(row);
    return q.includes("RETURNING id") ? [{ id: row.id }] : [];
  }

  private select(q: string, params: unknown[]): Row[] {
    if (q.startsWith("SELECT DISTINCT org_id")) {
      const ids = [...this.tables.values()].flatMap((rows) => rows.map((r) => String(r.org_id)));
      return [...new Set(ids)].sort().map((org_id) => ({ org_id }));
    }
    const table = /FROM (\w+)/.exec(q)?.[1] ?? "";
    let rows = this.rows(table).filter((r) => r.org_id === params[0]);
    if (/AND id = \$2/.test(q)) rows = rows.filter((r) => r.id === params[1]);
    if (/AND status = \$2/.test(q)) rows = rows.filter((r) => r.status === params[1]);
    if (/AND seq > \$2/.test(q)) rows = rows.filter((r) => Number(r.seq) > Number(params[1]));
    const order = /ORDER BY (\w+) (ASC|DESC)/.exec(q);
    if (order) {
      const [, col = "", dir] = order;
      rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true }) * (dir === "DESC" ? -1 : 1));
    }
    const limit = /LIMIT (\$(\d+)|(\d+))/.exec(q);
    if (limit) rows = rows.slice(0, limit[2] ? Number(params[Number(limit[2]) - 1]) : Number(limit[3]));
    return rows.map((r) => ({ metadata: r.metadata }));
  }
}

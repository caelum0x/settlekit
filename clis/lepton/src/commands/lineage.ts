/**
 * `lepton lineage shares` — walk a provenance lineage graph and print the
 * fractional attribution shares of a root work.
 *
 * Edges come from one of three sources (mutually exclusive):
 *   --edge child:parent:weight   (repeatable)
 *   --edges-file <path>          (JSON array of LineageEdge)
 *   --from-db                    (Pg lepton_lineage_edges via DATABASE_URL)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  LineageGraph,
  computeAttributionShares,
  loadLineageGraph,
  validateLineageEdge,
  type LineageEdge,
} from "@settlekit/attribution";
import { createConnection } from "@settlekit/database";
import { PgLineageStore } from "@settlekit/persistence";
import { buildContext } from "../context.js";
import { requireDatabaseUrl } from "../env.js";

/** A printable attribution-share row. */
interface ShareRow extends Record<string, unknown> {
  nodeId: string;
  share: number;
  depth: number;
}

/**
 * Parse a single `child:parent:weight` token into a validated {@link LineageEdge}.
 * Throws on malformed tokens or out-of-range weights (via validateLineageEdge).
 */
export function parseEdgeToken(token: string): LineageEdge {
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `Invalid --edge "${token}". Expected child:parent:weight (e.g. b:a:0.5).`,
    );
  }
  const [child, parent, weightStr] = parts as [string, string, string];
  if (child.trim() === "" || parent.trim() === "") {
    throw new Error(`Invalid --edge "${token}": child and parent must be non-empty.`);
  }
  const weight = Number(weightStr);
  if (!Number.isFinite(weight)) {
    throw new Error(`Invalid --edge "${token}": weight "${weightStr}" is not a number.`);
  }
  const candidate: LineageEdge = { child: child.trim(), parent: parent.trim(), weight };
  const validated = validateLineageEdge(candidate);
  if (!validated.ok) {
    throw validated.error;
  }
  return validated.value;
}

/** Parse a JSON array of edges from a file's contents. */
export function parseEdgesFile(contents: string): LineageEdge[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(
      `--edges-file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--edges-file must contain a JSON array of LineageEdge objects.");
  }
  return parsed.map((raw, index) => {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as { child?: unknown }).child !== "string" ||
      typeof (raw as { parent?: unknown }).parent !== "string" ||
      typeof (raw as { weight?: unknown }).weight !== "number"
    ) {
      throw new Error(`--edges-file entry ${index} is not a valid LineageEdge.`);
    }
    const edge = raw as LineageEdge;
    const validated = validateLineageEdge(edge);
    if (!validated.ok) {
      throw validated.error;
    }
    return validated.value;
  });
}

export function registerLineage(program: Command): void {
  const lineage = program.command("lineage").description("Inspect provenance lineage attribution");

  lineage
    .command("shares")
    .description("Compute attribution shares for a root id across the lineage graph")
    .requiredOption("--root <id>", "Root node id to attribute from")
    .option(
      "--edge <child:parent:weight>",
      "A lineage edge (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [] as string[],
    )
    .option("--edges-file <path>", "JSON array of LineageEdge")
    .option("--from-db", "Load edges from the Pg lepton lineage store (DATABASE_URL)", false)
    .action(async function (this: Command) {
      const flags = this.opts<{
        root: string;
        edge: string[];
        edgesFile?: string;
        fromDb?: boolean;
      }>();
      const ctx = buildContext(this);

      const rootId = flags.root.trim();
      if (rootId === "") {
        throw new Error("--root must not be empty.");
      }

      const sources = [
        flags.edge.length > 0,
        flags.edgesFile !== undefined,
        flags.fromDb === true,
      ].filter(Boolean).length;
      if (sources > 1) {
        throw new Error("Use only one of --edge / --edges-file / --from-db.");
      }

      let graph: LineageGraph;
      if (flags.fromDb === true) {
        const dbUrl = requireDatabaseUrl();
        const conn = createConnection(dbUrl);
        try {
          const store = new PgLineageStore(conn.db);
          graph = await loadLineageGraph(store);
        } finally {
          await conn.close();
        }
      } else if (flags.edgesFile !== undefined) {
        const contents = readFileSync(resolve(process.cwd(), flags.edgesFile), "utf8");
        graph = new LineageGraph(parseEdgesFile(contents));
      } else {
        graph = new LineageGraph(flags.edge.map(parseEdgeToken));
      }

      const shares = computeAttributionShares(graph, rootId);
      const rows: ShareRow[] = shares.map((s) => ({
        nodeId: s.nodeId,
        share: s.share,
        depth: s.depth,
      }));
      ctx.printList(rows, [
        { header: "NODE", value: (s) => s.nodeId },
        { header: "SHARE", value: (s) => s.share },
        { header: "DEPTH", value: (s) => s.depth },
      ]);
    });
}

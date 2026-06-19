/**
 * @settlekit/oss-fund — fund the maintainers your dependency tree leans on.
 *
 * Reads a `package.json` / `requirements.txt` (+ optional lockfile), maps the
 * dependency graph to maintainer wallets, lets an allocation engine split a small
 * monthly budget by how much you actually rely on each package — and settles the
 * result over SettleKit's nanopayment spine, so sub-cent gifts to thirty
 * maintainers cost nothing to move.
 */

export * from "./types.js";
export * from "./manifest.js";
export * from "./graph.js";
export * from "./signals.js";
export * from "./resolver.js";
export * from "./npm-resolver.js";
export * from "./usage-scan.js";
export * from "./conservation.js";
export * from "./allocation.js";
export * from "./heuristic-allocator.js";
export * from "./claude-allocator.js";
export * from "./plan.js";
export * from "./settle.js";
export * from "./seed.js";

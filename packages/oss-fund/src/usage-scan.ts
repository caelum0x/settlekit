/**
 * Usage scanning — the real "how much do you actually use it" signal.
 *
 * Walks a project's source tree and counts, for each dependency, how many of
 * your files import it. This is a far stronger signal than the structural
 * in-degree proxy: a package you import in forty modules clearly matters more to
 * you than one pulled in once. The result feeds `computeStructuralSignals`'
 * `usageCounts`. It only reports packages it found evidence for — packages it
 * never sees (e.g. a CLI tool you run but never import) fall back to the proxy,
 * so the scan augments the signal rather than zeroing honest dependencies.
 *
 * Pure filesystem + string work: no network, fully deterministic.
 */

import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Ecosystem } from "./types.js";

/** Options for {@link scanUsageCounts}. */
export interface UsageScanOptions {
  /** Which language's import syntax to look for. Defaults to "npm" (JS/TS). */
  ecosystem?: Ecosystem;
  /** Directory names to skip. Sensible build/vendor defaults are always added. */
  ignoreDirs?: readonly string[];
  /** Safety cap on files read. Defaults to 20000. */
  maxFiles?: number;
}

const ALWAYS_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".turbo",
]);

const JS_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const PY_EXTS = new Set([".py"]);

/** `import … from "x"`, `require("x")`, `import("x")`, `export … from "x"`. */
const JS_SPEC = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;
/** `import x[, y]` and `from x import …` (captures the dotted module path). */
const PY_IMPORT = /^\s*import\s+([A-Za-z0-9_.,\s]+)/;
const PY_FROM = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\b/;

/** A JS import specifier → its package name (handles scopes + subpaths). */
function npmPackageOf(spec: string): string | undefined {
  if (spec.length === 0 || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
    return undefined;
  }
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return spec.split("/")[0];
}

/** Normalize a name for cross-matching (pip dist names vs. import modules). */
function normalize(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

function packagesInFile(content: string, ecosystem: Ecosystem): Set<string> {
  const found = new Set<string>();
  if (ecosystem === "pypi") {
    for (const line of content.split(/\r?\n/)) {
      const from = PY_FROM.exec(line);
      if (from?.[1] !== undefined) {
        found.add(normalize(from[1].split(".")[0] as string));
        continue;
      }
      const imp = PY_IMPORT.exec(line);
      if (imp?.[1] !== undefined) {
        for (const mod of imp[1].split(",")) {
          const top = mod.trim().split(/\s+as\s+/)[0]?.split(".")[0];
          if (top !== undefined && top.length > 0) found.add(normalize(top));
        }
      }
    }
    return found;
  }
  JS_SPEC.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JS_SPEC.exec(content)) !== null) {
    const pkg = npmPackageOf(match[1] as string);
    if (pkg !== undefined) found.add(pkg);
  }
  return found;
}

/**
 * Count, for each name in `packageNames`, the number of source files under
 * `rootDir` that import it. Returns only names with a count ≥ 1.
 */
export async function scanUsageCounts(
  rootDir: string,
  packageNames: readonly string[],
  options: UsageScanOptions = {},
): Promise<Map<string, number>> {
  const ecosystem = options.ecosystem ?? "npm";
  const exts = ecosystem === "pypi" ? PY_EXTS : JS_EXTS;
  const maxFiles = options.maxFiles ?? 20_000;
  const ignore = new Set([...ALWAYS_IGNORE, ...(options.ignoreDirs ?? [])]);

  // For npm we match the requested names verbatim; for pypi we match normalized.
  const wanted = new Set(packageNames.map((n) => (ecosystem === "pypi" ? normalize(n) : n)));
  const counts = new Map<string, number>();
  const bump = (name: string): void => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };

  let filesRead = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than fail the whole scan.
    }
    for (const entry of entries) {
      if (filesRead >= maxFiles) return;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && entry.name !== ".github") continue;
        if (ignore.has(entry.name)) continue;
        await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !exts.has(extname(entry.name))) continue;
      filesRead += 1;
      let content;
      try {
        content = await readFile(join(dir, entry.name), "utf8");
      } catch {
        continue;
      }
      for (const pkg of packagesInFile(content, ecosystem)) {
        const key = ecosystem === "pypi" ? normalize(pkg) : pkg;
        if (wanted.has(key)) bump(key);
      }
    }
  };

  await walk(rootDir);
  return counts;
}

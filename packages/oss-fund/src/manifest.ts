/**
 * Manifest + lockfile parsing.
 *
 * The entry point of the whole pipeline: a developer's `package.json` or
 * `requirements.txt` becomes a list of direct dependencies, and an optional
 * `package-lock.json` becomes the transitive edge set so the allocator can reason
 * about criticality (how load-bearing each package is), not just direct deps.
 */

import type { DependencyKind, Ecosystem } from "./types.js";

/** A directly declared dependency. */
export interface DirectDependency {
  name: string;
  kind: DependencyKind;
  versionRange?: string;
}

/** The parsed direct-dependency view of a manifest. */
export interface ParsedManifest {
  ecosystem: Ecosystem;
  root?: string;
  direct: DirectDependency[];
}

/** A parsed lockfile: each package mapped to the dependency names it pulls in. */
export interface ParsedLockfile {
  ecosystem: "npm";
  /** package name → its direct dependency names (transitive edges of your tree). */
  adjacency: Map<string, string[]>;
  /** Resolved versions by package name, when the lockfile records them. */
  versions: Map<string, string>;
}

interface PackageJsonShape {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function collect(
  source: unknown,
  kind: DependencyKind,
  into: Map<string, DirectDependency>,
): void {
  for (const [name, range] of Object.entries(asRecord(source))) {
    // First declaration wins, except a prod declaration always upgrades a node
    // that was first seen as a weaker kind (peer/optional/dev).
    const existing = into.get(name);
    if (existing === undefined || (kind === "prod" && existing.kind !== "prod")) {
      into.set(name, {
        name,
        kind,
        ...(typeof range === "string" ? { versionRange: range } : {}),
      });
    }
  }
}

/** Parse a `package.json` into its direct dependencies. */
export function parsePackageJson(content: string): ParsedManifest {
  const json = JSON.parse(content) as PackageJsonShape;
  const direct = new Map<string, DirectDependency>();
  // Order matters: prod is collected last so it wins on conflicts.
  collect(json.devDependencies, "dev", direct);
  collect(json.peerDependencies, "peer", direct);
  collect(json.optionalDependencies, "optional", direct);
  collect(json.dependencies, "prod", direct);
  return {
    ecosystem: "npm",
    ...(typeof json.name === "string" ? { root: json.name } : {}),
    direct: [...direct.values()],
  };
}

const REQ_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([<>=!~][^;#]*)?/;

/**
 * Parse a `requirements.txt`. Comments, blank lines, `-r`/`-e`/option lines, and
 * VCS/URL installs are skipped; everything Python pins is a direct, prod-kind dep.
 */
export function parseRequirementsTxt(content: string): ParsedManifest {
  const direct = new Map<string, DirectDependency>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("-")) continue;
    if (line.includes("://") || line.startsWith("git+")) continue;
    const match = REQ_LINE.exec(line);
    if (match === null || match[1] === undefined) continue;
    const name = match[1].toLowerCase();
    if (direct.has(name)) continue;
    direct.set(name, {
      name,
      kind: "prod",
      ...(match[2] !== undefined ? { versionRange: match[2].trim() } : {}),
    });
  }
  return { ecosystem: "pypi", direct: [...direct.values()] };
}

interface LockEntry {
  version?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
}

/** The last `node_modules/`-separated segment is the real package name (handles nesting + scopes). */
function lockKeyToName(key: string): string | undefined {
  if (key === "") return undefined;
  const idx = key.lastIndexOf("node_modules/");
  const name = idx >= 0 ? key.slice(idx + "node_modules/".length) : key;
  return name.length > 0 ? name : undefined;
}

/**
 * Parse an npm `package-lock.json` (lockfileVersion 2/3) into the transitive
 * dependency graph. Each `packages` entry contributes edges to the runtime +
 * optional dependencies it declares. The flat layout means we key by package
 * name; nested duplicate versions collapse to a single node, which is exactly
 * the granularity the maintainer-funding signals need.
 */
export function parsePackageLock(content: string): ParsedLockfile {
  const json = JSON.parse(content) as { packages?: Record<string, LockEntry> };
  const adjacency = new Map<string, string[]>();
  const versions = new Map<string, string>();
  const packages = asRecord(json.packages) as Record<string, LockEntry>;

  for (const [key, entry] of Object.entries(packages)) {
    const name = lockKeyToName(key);
    if (name === undefined) continue;
    if (typeof entry.version === "string" && !versions.has(name)) {
      versions.set(name, entry.version);
    }
    const deps = new Set(adjacency.get(name) ?? []);
    for (const dep of Object.keys(asRecord(entry.dependencies))) deps.add(dep);
    for (const dep of Object.keys(asRecord(entry.optionalDependencies))) deps.add(dep);
    adjacency.set(name, [...deps]);
  }

  return { ecosystem: "npm", adjacency, versions };
}

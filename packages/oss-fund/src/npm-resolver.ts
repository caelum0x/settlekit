/**
 * Real maintainer resolution from live package metadata.
 *
 * Replaces the hardcoded seed map with the actual chain every funding tool needs:
 *
 *   npm package → registry metadata → `repository` URL → GitHub owner
 *              → (optional) `.github/FUNDING.yml` → funding handle + URL
 *              → payout wallet (payee registry) or escrow
 *
 * The GitHub owner is the maintainer identity (the payee external id); whether
 * that identity has a registered wallet is the existing registry/escrow split.
 * `FUNDING.yml` refines the identity (a project may direct funding to a specific
 * sponsor login) and yields a funding/claim URL to surface to unclaimed
 * maintainers. Resolution never throws — any network or parse failure degrades
 * to escrow, so a flaky lookup can't break the plan. Results are cached per
 * package, and `fetchImpl` is injectable so this is testable offline.
 */

import { walletFor, type PayeeRegistry } from "@settlekit/payee-registry";
import type { MaintainerResolver } from "./resolver.js";
import type { ResolvedMaintainer } from "./types.js";

/** Options for {@link NpmRegistryResolver}. */
export interface NpmResolverOptions {
  /** Source of truth for handle → wallet (claimed maintainers). */
  registry: PayeeRegistry;
  /** Wallet that holds shares for maintainers without a registered wallet. */
  escrowWallet: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** npm registry base URL. Defaults to the public registry. */
  registryUrl?: string;
  /** Also read GitHub FUNDING.yml to refine the handle + capture a funding URL. */
  readFunding?: boolean;
  /** Per-request timeout (ms). Defaults to 8000. */
  timeoutMs?: number;
}

interface ResolvedMeta {
  handle?: string;
  fundingUrl?: string;
}

const GITHUB_RE = /github(?:\.com[/:]|:)([^/\s]+)\/([^/.#\s]+)/i;

/** Extract a GitHub owner/repo from any of npm's `repository` URL shapes. */
function parseGitHub(repository: unknown): { owner: string; repo: string } | undefined {
  const raw =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" && repository !== null
        ? (repository as { url?: unknown }).url
        : undefined;
  if (typeof raw !== "string") return undefined;
  if (raw.startsWith("github:")) {
    const [owner, repo] = raw.slice("github:".length).split("/");
    return owner !== undefined && repo !== undefined ? { owner, repo } : undefined;
  }
  const m = GITHUB_RE.exec(raw);
  return m?.[1] !== undefined && m[2] !== undefined ? { owner: m[1], repo: m[2] } : undefined;
}

/** Pull a funding URL from npm's `funding` field (string | object | array). */
function fundingUrlOf(funding: unknown): string | undefined {
  const one = (f: unknown): string | undefined => {
    if (typeof f === "string") return f;
    if (typeof f === "object" && f !== null) {
      const url = (f as { url?: unknown }).url;
      return typeof url === "string" ? url : undefined;
    }
    return undefined;
  };
  if (Array.isArray(funding)) {
    for (const f of funding) {
      const url = one(f);
      if (url !== undefined) return url;
    }
    return undefined;
  }
  return one(funding);
}

/** Parse the bits of FUNDING.yml we care about (no YAML dependency needed). */
function parseFunding(yml: string): ResolvedMeta {
  const result: ResolvedMeta = {};
  for (const rawLine of yml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    const gh = /^github:\s*(.+)$/i.exec(line);
    if (gh?.[1] !== undefined && result.handle === undefined) {
      const first = gh[1]
        .replace(/[[\]"']/g, "")
        .split(",")[0]
        ?.trim();
      if (first !== undefined && first.length > 0) {
        result.handle = first;
        result.fundingUrl = `https://github.com/sponsors/${first}`;
      }
      continue;
    }
    const oc = /^open_collective:\s*["']?([^"'\s]+)/i.exec(line);
    if (oc?.[1] !== undefined && result.fundingUrl === undefined) {
      result.fundingUrl = `https://opencollective.com/${oc[1]}`;
      continue;
    }
    const custom = /^custom:\s*(.+)$/i.exec(line);
    if (custom?.[1] !== undefined && result.fundingUrl === undefined) {
      const url = custom[1]
        .replace(/[[\]"']/g, "")
        .split(",")[0]
        ?.trim();
      if (url !== undefined && url.length > 0) result.fundingUrl = url;
    }
  }
  return result;
}

export class NpmRegistryResolver implements MaintainerResolver {
  private readonly cache = new Map<string, ResolvedMaintainer>();
  private readonly fetchImpl: typeof fetch;
  private readonly registryUrl: string;
  private readonly readFunding: boolean;
  private readonly timeoutMs: number;

  constructor(private readonly options: NpmResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.registryUrl = (options.registryUrl ?? "https://registry.npmjs.org").replace(/\/$/, "");
    this.readFunding = options.readFunding ?? true;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async getJson(url: string): Promise<unknown | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      return response.ok ? ((await response.json()) as unknown) : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getText(url: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      return response.ok ? await response.text() : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async lookup(packageName: string): Promise<ResolvedMeta> {
    const meta = await this.getJson(`${this.registryUrl}/${packageName.replace("/", "%2F")}`);
    if (typeof meta !== "object" || meta === null) return {};
    const record = meta as Record<string, unknown>;
    const repo = parseGitHub(record["repository"]);
    let handle = repo?.owner.toLowerCase();
    let fundingUrl = fundingUrlOf(record["funding"]);

    if (this.readFunding && repo !== undefined) {
      const yml =
        (await this.getText(
          `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/.github/FUNDING.yml`,
        )) ?? (await this.getText(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/FUNDING.yml`));
      if (yml !== undefined) {
        const parsed = parseFunding(yml);
        if (parsed.handle !== undefined) handle = parsed.handle.toLowerCase();
        if (parsed.fundingUrl !== undefined) fundingUrl = parsed.fundingUrl;
      }
    }

    return {
      ...(handle !== undefined ? { handle } : {}),
      ...(fundingUrl !== undefined ? { fundingUrl } : {}),
    };
  }

  async resolve(packageName: string): Promise<ResolvedMaintainer> {
    const cached = this.cache.get(packageName);
    if (cached !== undefined) return cached;

    const { handle, fundingUrl } = await this.lookup(packageName);

    let result: ResolvedMaintainer;
    if (handle === undefined) {
      result = {
        wallet: this.options.escrowWallet,
        claimed: false,
        existingMonthlyUsd: "0",
        ...(fundingUrl !== undefined ? { fundingUrl } : {}),
      };
    } else {
      const wallet =
        (await walletFor(this.options.registry, "handle", handle, this.options.escrowWallet)) ??
        this.options.escrowWallet;
      result = {
        handle,
        wallet,
        claimed: wallet !== this.options.escrowWallet,
        existingMonthlyUsd: "0",
        ...(fundingUrl !== undefined ? { fundingUrl } : {}),
      };
    }

    this.cache.set(packageName, result);
    return result;
  }
}

/**
 * Policy administration: the org's stored policy (or defaults, with caps
 * read from the vault), JSON parsing at the API boundary, and a drift guard.
 * The off-chain policy must never promise what the vault will not do, so a
 * PUT whose caps differ from the on-chain caps, or whose allowlist names a
 * payee the vault does not allowlist, is refused.
 */
import type { PolicySource } from "./context.js";
import type { VaultStateReader } from "./executor.js";
import { validatePolicy, type OperatorPolicy } from "./policy.js";
import type { OperatorStore } from "./store.js";
import { formatUsdc, parseUsdc } from "./usdc.js";

export class PolicyDriftError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Policy drifts from on-chain vault: ${issues.join("; ")}`);
    this.name = "PolicyDriftError";
    this.issues = issues;
  }
}

export class PolicyValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid policy: ${issues.join("; ")}`);
    this.name = "PolicyValidationError";
    this.issues = issues;
  }
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MONEY_FIELDS = ["perTxCap", "dailyCap", "escalateAbove", "minFloat", "yieldTarget"] as const;

/** JSON-safe view: money as decimal USDC strings. */
export function policyView(policy: OperatorPolicy): Record<string, unknown> {
  return {
    ...policy,
    ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, formatUsdc(policy[f])])),
    allowlist: [...policy.allowlist],
  };
}

function money(raw: Record<string, unknown>, field: string, issues: string[], allowZero: boolean): bigint {
  const value = raw[field];
  if (allowZero && (value === "0" || value === 0)) return 0n;
  try {
    return parseUsdc(String(value ?? ""));
  } catch {
    issues.push(`${field} must be a ${allowZero ? "non-negative" : "positive"} USDC amount`);
    return 0n;
  }
}

/** Parse an untrusted policy body (money as decimal USDC strings). */
export function parsePolicy(input: unknown): OperatorPolicy {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new PolicyValidationError(["policy must be an object"]);
  const raw = input as Record<string, unknown>;
  const issues: string[] = [];
  const split = (raw.split ?? {}) as Record<string, unknown>;
  const allowlist = Array.isArray(raw.allowlist) ? raw.allowlist : [];
  if (!Array.isArray(raw.allowlist) || allowlist.some((a) => typeof a !== "string" || !ADDRESS_RE.test(a))) {
    issues.push("allowlist must be an array of 0x addresses");
  }
  const policy: OperatorPolicy = {
    split: { OPERATING: Number(split.OPERATING), YIELD: Number(split.YIELD), REFUND: Number(split.REFUND) },
    taxRateBps: Number(raw.taxRateBps),
    perTxCap: money(raw, "perTxCap", issues, false),
    dailyCap: money(raw, "dailyCap", issues, false),
    escalateAbove: money(raw, "escalateAbove", issues, true),
    minFloat: money(raw, "minFloat", issues, true),
    yieldTarget: money(raw, "yieldTarget", issues, true),
    allowlist: allowlist.map((a) => String(a).toLowerCase()),
    maxX402PerDay: Number(raw.maxX402PerDay),
  };
  const all = [...issues, ...validatePolicy(policy)];
  if (all.length > 0) throw new PolicyValidationError(all);
  return policy;
}

export interface PolicyAdminOptions {
  readonly store: OperatorStore;
  readonly defaults: OperatorPolicy;
  /** Present when a real (or simulated) vault is configured. */
  readonly vault?: VaultStateReader;
}

export class PolicyAdmin implements PolicySource {
  constructor(private readonly options: PolicyAdminOptions) {}

  async get(orgId: string): Promise<OperatorPolicy> {
    const stored = await this.options.store.getPolicy(orgId);
    if (stored) return stored;
    if (!this.options.vault) return this.options.defaults;
    return { ...this.options.defaults, ...(await this.options.vault.caps()) };
  }

  /** Differences between a policy and the vault's on-chain configuration. */
  async drift(policy: OperatorPolicy): Promise<readonly string[]> {
    const vault = this.options.vault;
    if (!vault) return [];
    const caps = await vault.caps();
    const issues = (["perTxCap", "dailyCap", "escalateAbove"] as const)
      .filter((f) => policy[f] !== caps[f])
      .map((f) => `${f} ${formatUsdc(policy[f])} != on-chain ${formatUsdc(caps[f])}`);
    const flags = await Promise.all(policy.allowlist.map((a) => vault.isAllowlisted(a)));
    const missing = policy.allowlist.filter((_, i) => !flags[i]).map((a) => `${a} is not allowlisted on-chain`);
    return [...issues, ...missing];
  }

  async put(orgId: string, input: unknown): Promise<OperatorPolicy> {
    const policy = parsePolicy(input);
    const drift = await this.drift(policy);
    if (drift.length > 0) throw new PolicyDriftError(drift);
    return this.options.store.savePolicy(orgId, policy);
  }
}

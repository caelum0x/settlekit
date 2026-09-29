/**
 * Gas budget guard for the relayer hot key.
 *
 * Before every settlement the facilitator prices the transaction it is about
 * to send (assumed gas limit for the transfer method x live gas price) and
 * refuses when:
 *   - the network has no configured budget (fail closed),
 *   - one settlement would cost more than `maxFeePerSettlement`,
 *   - the rolling 24h spend on that network would exceed `dailyBudget`,
 *   - the relayer balance would drop below `minRelayerBalance` + the fee.
 * Fees are in the chain's native gas unit (wei; HYPE on HyperEVM; the USD fee
 * token on Tempo), so every limit is configured per CAIP-2 network.
 */
import type { AssetTransferMethod } from "./assets.js";

export interface GasOracle {
  /** Current gas price for `caip2` (native units per gas). */
  gasPrice(caip2: string): Promise<bigint>;
  /** The relayer's native balance on `caip2`. */
  relayerBalance(caip2: string): Promise<bigint>;
}

export interface NetworkGasBudget {
  /** Highest fee one settlement may cost. */
  maxFeePerSettlement: bigint;
  /** Rolling 24h spend cap. Omit for no daily cap. */
  dailyBudget?: bigint;
  /** Balance the relayer must keep after paying the fee. Defaults to 0. */
  minRelayerBalance?: bigint;
}

export interface GasBudgetConfig {
  /** Budgets keyed by CAIP-2 network. Networks without a budget are refused. */
  networks: Readonly<Record<string, NetworkGasBudget>>;
  /** Gas limit assumed per settlement. Defaults: eip3009 120k, permit2 220k. */
  gasPerSettlement?: Partial<Record<AssetTransferMethod, bigint>>;
}

export const DEFAULT_GAS_PER_SETTLEMENT: Readonly<Record<AssetTransferMethod, bigint>> = {
  eip3009: 120_000n,
  permit2: 220_000n,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type GasCheck =
  | { ok: true; estimatedFee: bigint }
  | { ok: false; reason: "gas_budget_missing" | "gas_budget_exceeded" | "relayer_balance_too_low"; message: string };

export class GasGuard {
  private readonly spend = new Map<string, Array<{ at: number; fee: bigint }>>();

  constructor(
    private readonly oracle: GasOracle,
    private readonly config: GasBudgetConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Price a settlement on `caip2` and check it against every limit. */
  async check(caip2: string, method: AssetTransferMethod): Promise<GasCheck> {
    const budget = this.config.networks[caip2];
    if (!budget) {
      return { ok: false, reason: "gas_budget_missing", message: `no gas budget configured for ${caip2}` };
    }
    const gas = this.config.gasPerSettlement?.[method] ?? DEFAULT_GAS_PER_SETTLEMENT[method];
    const estimatedFee = gas * (await this.oracle.gasPrice(caip2));
    if (estimatedFee > budget.maxFeePerSettlement) {
      return {
        ok: false,
        reason: "gas_budget_exceeded",
        message: `settlement fee ${estimatedFee} exceeds per-settlement cap ${budget.maxFeePerSettlement} on ${caip2}`,
      };
    }
    if (budget.dailyBudget !== undefined) {
      const spent = this.spentLastDay(caip2);
      if (spent + estimatedFee > budget.dailyBudget) {
        return {
          ok: false,
          reason: "gas_budget_exceeded",
          message: `24h relayer spend ${spent + estimatedFee} would exceed daily budget ${budget.dailyBudget} on ${caip2}`,
        };
      }
    }
    const balance = await this.oracle.relayerBalance(caip2);
    if (balance < estimatedFee + (budget.minRelayerBalance ?? 0n)) {
      return {
        ok: false,
        reason: "relayer_balance_too_low",
        message: `relayer balance ${balance} cannot cover fee ${estimatedFee} plus reserve on ${caip2}`,
      };
    }
    return { ok: true, estimatedFee };
  }

  /** Count a broadcast settlement against the network's rolling budget. */
  record(caip2: string, fee: bigint): void {
    const entries = this.prune(caip2);
    this.spend.set(caip2, [...entries, { at: this.now(), fee }]);
  }

  /** Fees counted on `caip2` within the last 24h. */
  spentLastDay(caip2: string): bigint {
    return this.prune(caip2).reduce((total, entry) => total + entry.fee, 0n);
  }

  private prune(caip2: string): Array<{ at: number; fee: bigint }> {
    const cutoff = this.now() - DAY_MS;
    const kept = (this.spend.get(caip2) ?? []).filter((entry) => entry.at > cutoff);
    this.spend.set(caip2, kept);
    return kept;
  }
}

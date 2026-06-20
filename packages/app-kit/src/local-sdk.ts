/**
 * {@link LocalAppKitSdk} — a deterministic, in-memory {@link AppKitSdk} for
 * tests, demos, and local development. It never touches a chain: it records
 * every call and returns synthetic, monotonically-numbered transaction hashes
 * so assertions are stable across runs. The signing adapter is a plain string
 * label.
 */

import type {
  AppKitSdk,
  SdkBridgeParams,
  SdkDepositParams,
  SdkEstimate,
  SdkResult,
  SdkSendParams,
  SdkSpendParams,
  SdkSwapParams,
} from "./sdk.js";
import type { TransferKind } from "./types.js";

/** A single recorded operation, for test assertions. */
export interface RecordedCall {
  kind: TransferKind;
  amount: string;
  chain: string;
}

/** Options controlling the local SDK's simulated behavior. */
export interface LocalAppKitOptions {
  /** SDK `state` returned by every operation. Default "success". */
  state?: string;
  /** Operations named here throw, to exercise error-handling paths. */
  throwOn?: readonly TransferKind[];
}

export class LocalAppKitSdk implements AppKitSdk<string> {
  private readonly state: string;
  private readonly throwOn: ReadonlySet<TransferKind>;
  private counter = 0;
  private readonly recorded: RecordedCall[] = [];
  private lastSwapConfigValue: SdkSwapParams<string>["config"];

  readonly unifiedBalance: {
    deposit(params: SdkDepositParams<string>): Promise<SdkResult>;
    spend(params: SdkSpendParams<string>): Promise<SdkResult>;
  };

  constructor(options: LocalAppKitOptions = {}) {
    this.state = options.state ?? "success";
    this.throwOn = new Set(options.throwOn ?? []);
    this.unifiedBalance = {
      deposit: (params) =>
        this.simulate("deposit", "deposit", params.amount, params.from.chain),
      spend: (params) =>
        this.simulate("spend", "spend", params.amountIn, params.to.chain),
    };
  }

  /** All calls made so far, oldest first. */
  calls(): readonly RecordedCall[] {
    return [...this.recorded];
  }

  /**
   * The `config` passed to the most recent {@link swap} call, or `undefined` if
   * no swap has run yet. Returns a defensive copy so assertions cannot mutate
   * recorded state.
   */
  lastSwapConfig(): SdkSwapParams<string>["config"] {
    if (this.lastSwapConfigValue === undefined) return undefined;
    const { kitKey, slippageTolerance, fee } = this.lastSwapConfigValue;
    return {
      ...(kitKey !== undefined ? { kitKey } : {}),
      ...(slippageTolerance !== undefined ? { slippageTolerance } : {}),
      ...(fee !== undefined ? { fee: { recipient: fee.recipient, bps: fee.bps } } : {}),
    };
  }

  private async simulate(
    kind: TransferKind,
    name: string,
    amount: string,
    chain: string,
  ): Promise<SdkResult> {
    if (this.throwOn.has(kind)) {
      throw new Error(`simulated ${kind} failure`);
    }
    this.recorded.push({ kind, amount, chain });
    this.counter += 1;
    const txHash = `0xlocal${this.counter.toString(16).padStart(8, "0")}`;
    return {
      name,
      state: this.state,
      txHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
    };
  }

  send(params: SdkSendParams<string>): Promise<SdkResult> {
    return this.simulate("send", "transfer", params.amount, params.from.chain);
  }

  async estimateSend(_params: SdkSendParams<string>): Promise<SdkEstimate> {
    return { gas: "21000", fee: "0.0001", gasPrice: "1" };
  }

  bridge(params: SdkBridgeParams<string>): Promise<SdkResult> {
    return this.simulate("bridge", "bridge", params.amount, params.from.chain);
  }

  swap(params: SdkSwapParams<string>): Promise<SdkResult> {
    this.lastSwapConfigValue = params.config;
    return this.simulate("swap", "swap", params.amountIn, params.from.chain);
  }
}

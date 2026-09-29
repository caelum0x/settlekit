/**
 * An in-memory EVM that simulates exactly the contract behaviour onchain
 * billing depends on (ERC-20, Permit2 AllowanceTransfer, SpendPermissionManager,
 * AuthCaptureEscrow + collectors), transcribed from the audited sources.
 * Signatures are verified for real with viem (EOA ECDSA recovery), so tests
 * sign with real keys. Failure injection covers reverts and "broadcast but the
 * receipt never came back" (indeterminate) paths.
 */
import { getAddress, keccak256, toHex, verifyTypedData, zeroAddress, type TypedDataDefinition } from "viem";
import type { Hex } from "@settlekit/chains";
import { COMMERCE_PAYMENTS_V1_1, PERMIT2_ADDRESS, SPEND_PERMISSION_MANAGER } from "../src/addresses.js";
import { erc3009AuthorizationTypedData, hashPaymentInfo, type PaymentInfo, type TokenEip712Domain } from "../src/commerce-escrow.js";
import type { ContractCall, EvmOperator, TxReceipt } from "../src/evm.js";
import { permitSingleTypedData, type PermitSingle } from "../src/permit2-allowance.js";
import { hashSpendPermission, spendPermissionTypedData, type SpendPermission } from "../src/spend-permission.js";

export type FailureMode = "revert" | "lost_receipt" | "throw_on_write";

const lc = (a: string) => a.toLowerCase();
const MAX160 = (1n << 160n) - 1n;

class Revert extends Error {}

export class FakeEvm {
  blockTime: bigint;
  readonly balances = new Map<string, bigint>();
  readonly erc20Allowances = new Map<string, bigint>();
  readonly permit2 = new Map<string, { amount: bigint; expiration: number; nonce: number }>();
  readonly spmApproved = new Set<string>();
  readonly spmRevoked = new Set<string>();
  readonly spmSpend = new Map<string, { start: number; spend: bigint }>();
  readonly escrow = new Map<string, { has: boolean; capturable: bigint; refundable: bigint }>();
  readonly receipts = new Map<string, TxReceipt>();
  readonly lostReceipts = new Set<string>();
  readonly txs: Array<{ from: string; functionName: string; address: string; args: readonly unknown[]; hash: Hex }> = [];
  private failures: Array<{ functionName: string; mode: FailureMode }> = [];
  private counter = 0;
  /** Delay applied to every write (concurrency tests). */
  writeDelayMs = 0;

  constructor(
    readonly chainId: number,
    readonly tokenDomains: Record<string, TokenEip712Domain> = {},
    startTime = 1_800_000_000n,
  ) {
    this.blockTime = startTime;
  }

  failNext(functionName: string, mode: FailureMode): void {
    this.failures.push({ functionName, mode });
  }

  /** Make lost receipts visible (the tx did land). */
  mineLost(): void {
    this.lostReceipts.clear();
  }

  mint(token: string, holder: string, amount: bigint): void {
    const key = `${lc(token)}|${lc(holder)}`;
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount);
  }

  balanceOf(token: string, holder: string): bigint {
    return this.balances.get(`${lc(token)}|${lc(holder)}`) ?? 0n;
  }

  setErc20Allowance(token: string, owner: string, spender: string, amount: bigint): void {
    this.erc20Allowances.set(`${lc(token)}|${lc(owner)}|${lc(spender)}`, amount);
  }

  private move(token: string, from: string, to: string, amount: bigint): void {
    const bal = this.balanceOf(token, from);
    if (bal < amount) throw new Revert("ERC20: transfer amount exceeds balance");
    this.balances.set(`${lc(token)}|${lc(from)}`, bal - amount);
    this.mint(token, to, amount);
  }

  private spendAllowance(token: string, owner: string, spender: string, amount: bigint): void {
    const key = `${lc(token)}|${lc(owner)}|${lc(spender)}`;
    const current = this.erc20Allowances.get(key) ?? 0n;
    if (current < amount) throw new Revert("ERC20: insufficient allowance");
    if (current !== 2n ** 256n - 1n) this.erc20Allowances.set(key, current - amount);
  }

  operator(address: Hex): EvmOperator {
    const chain = this;
    return {
      address: getAddress(address),
      chainId: this.chainId,
      async read<T>(call: ContractCall): Promise<T> {
        return chain.read(call) as T;
      },
      async write(call: ContractCall): Promise<Hex> {
        if (chain.writeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, chain.writeDelayMs));
        return await chain.write(address, call);
      },
      async waitForReceipt(hash: Hex): Promise<TxReceipt> {
        if (chain.lostReceipts.has(hash)) throw new Error("timed out waiting for receipt");
        const receipt = chain.receipts.get(hash);
        if (!receipt) throw new Error(`unknown tx ${hash}`);
        return receipt;
      },
      async getReceipt(hash: Hex): Promise<TxReceipt | null> {
        if (chain.lostReceipts.has(hash)) return null;
        return chain.receipts.get(hash) ?? null;
      },
      async verifyTypedData(args: { address: Hex; signature: Hex } & TypedDataDefinition): Promise<boolean> {
        return verifyTypedData(args as never);
      },
      async blockTimestamp() {
        return chain.blockTime;
      },
    };
  }

  private read(call: ContractCall): unknown {
    const to = lc(call.address);
    const a = call.args;
    if (to === lc(PERMIT2_ADDRESS)) {
      if (call.functionName === "allowance") {
        const entry = this.permit2.get(`${lc(a[0] as string)}|${lc(a[1] as string)}|${lc(a[2] as string)}`);
        return [entry?.amount ?? 0n, entry?.expiration ?? 0, entry?.nonce ?? 0];
      }
    }
    if (to === lc(SPEND_PERMISSION_MANAGER)) {
      const p = a[0] as SpendPermission;
      const hash = hashSpendPermission(this.chainId, p);
      switch (call.functionName) {
        case "isApproved":
          return this.spmApproved.has(hash);
        case "isRevoked":
          return this.spmRevoked.has(hash);
        case "isValid":
          return this.spmValid(p, hash);
        case "getCurrentPeriod":
          return this.spmPeriod(p, hash);
        case "getHash":
          return hash;
      }
    }
    if (to === lc(COMMERCE_PAYMENTS_V1_1.authCaptureEscrow)) {
      if (call.functionName === "paymentState") {
        const s = this.escrow.get(a[0] as string);
        return [s?.has ?? false, s?.capturable ?? 0n, s?.refundable ?? 0n];
      }
    }
    switch (call.functionName) {
      case "balanceOf":
        return this.balanceOf(to, a[0] as string);
      case "allowance":
        return this.erc20Allowances.get(`${to}|${lc(a[0] as string)}|${lc(a[1] as string)}`) ?? 0n;
    }
    throw new Error(`fake chain cannot read ${call.functionName} on ${call.address}`);
  }

  private spmValid(p: SpendPermission, hash: string): boolean {
    const t = Number(this.blockTime);
    return this.spmApproved.has(hash) && !this.spmRevoked.has(hash) && t >= p.start && t < p.end;
  }

  private spmPeriod(p: SpendPermission, hash: string): { start: number; end: number; spend: bigint } {
    const t = Number(this.blockTime);
    const start = p.start + Math.floor((t - p.start) / p.period) * p.period;
    const stored = this.spmSpend.get(hash);
    return { start, end: Math.min(start + p.period, p.end), spend: stored?.start === start ? stored.spend : 0n };
  }

  private async write(sender: Hex, call: ContractCall): Promise<Hex> {
    this.counter += 1;
    const hash = keccak256(toHex(`${this.chainId}:${this.counter}:${call.functionName}`));
    const failIndex = this.failures.findIndex((f) => f.functionName === call.functionName);
    const failure = failIndex >= 0 ? this.failures.splice(failIndex, 1)[0] : undefined;
    if (failure?.mode === "throw_on_write") throw new Error("rpc unavailable");
    this.txs.push({ from: sender, functionName: call.functionName, address: call.address, args: call.args, hash });
    let status: TxReceipt["status"] = "success";
    if (failure?.mode === "revert") {
      status = "reverted";
    } else {
      const snapshot = this.snapshot();
      try {
        await this.execute(lc(sender), call);
      } catch (error) {
        if (!(error instanceof Revert)) throw error;
        this.restore(snapshot);
        status = "reverted";
      }
    }
    this.receipts.set(hash, { transactionHash: hash, status, blockNumber: BigInt(this.counter) });
    if (failure?.mode === "lost_receipt") this.lostReceipts.add(hash);
    return hash;
  }

  private snapshot() {
    return {
      balances: new Map(this.balances),
      erc20Allowances: new Map(this.erc20Allowances),
      permit2: new Map([...this.permit2].map(([k, v]) => [k, { ...v }])),
      spmApproved: new Set(this.spmApproved),
      spmRevoked: new Set(this.spmRevoked),
      spmSpend: new Map([...this.spmSpend].map(([k, v]) => [k, { ...v }])),
      escrow: new Map([...this.escrow].map(([k, v]) => [k, { ...v }])),
    };
  }

  private restore(s: ReturnType<FakeEvm["snapshot"]>): void {
    for (const [target, source] of [
      [this.balances, s.balances],
      [this.erc20Allowances, s.erc20Allowances],
      [this.permit2, s.permit2],
      [this.spmSpend, s.spmSpend],
      [this.escrow, s.escrow],
    ] as const) {
      (target as Map<string, unknown>).clear();
      for (const [k, v] of source as Map<string, unknown>) (target as Map<string, unknown>).set(k, v);
    }
    this.spmApproved.clear();
    s.spmApproved.forEach((v) => this.spmApproved.add(v));
    this.spmRevoked.clear();
    s.spmRevoked.forEach((v) => this.spmRevoked.add(v));
  }

  private async execute(sender: string, call: ContractCall): Promise<void> {
    const to = lc(call.address);
    const a = call.args;
    if (to === lc(PERMIT2_ADDRESS)) return this.executePermit2(sender, call.functionName, a);
    if (to === lc(SPEND_PERMISSION_MANAGER)) return this.executeSpm(sender, call.functionName, a);
    if (to === lc(COMMERCE_PAYMENTS_V1_1.authCaptureEscrow)) return this.executeEscrow(sender, call.functionName, a);
    switch (call.functionName) {
      case "transfer":
        return this.move(to, sender, a[0] as string, a[1] as bigint);
      case "approve":
        return this.setErc20Allowance(to, sender, a[0] as string, a[1] as bigint);
    }
    throw new Error(`fake chain cannot execute ${call.functionName} on ${call.address}`);
  }

  private async executePermit2(sender: string, fn: string, a: readonly unknown[]): Promise<void> {
    if (fn === "permit") {
      const owner = a[0] as Hex;
      const permit = a[1] as PermitSingle;
      const key = `${lc(owner)}|${lc(permit.details.token)}|${lc(permit.spender)}`;
      const current = this.permit2.get(key) ?? { amount: 0n, expiration: 0, nonce: 0 };
      if (permit.sigDeadline < this.blockTime) throw new Revert("SignatureExpired");
      if (permit.details.nonce !== current.nonce) throw new Revert("InvalidNonce");
      const valid = await verifyTypedData({ ...(permitSingleTypedData(this.chainId, permit) as never), address: owner, signature: a[2] as Hex });
      if (!valid) throw new Revert("InvalidSigner");
      this.permit2.set(key, { amount: permit.details.amount, expiration: permit.details.expiration, nonce: current.nonce + 1 });
      return;
    }
    if (fn === "transferFrom") {
      const [from, recipient, amount, token] = a as [Hex, Hex, bigint, Hex];
      const key = `${lc(from)}|${lc(token)}|${sender}`;
      const allowed = this.permit2.get(key);
      if (!allowed || Number(this.blockTime) > allowed.expiration) throw new Revert("AllowanceExpired");
      if (allowed.amount !== MAX160) {
        if (allowed.amount < amount) throw new Revert("InsufficientAllowance");
        this.permit2.set(key, { ...allowed, amount: allowed.amount - amount });
      }
      this.spendAllowance(token, from, PERMIT2_ADDRESS, amount);
      this.move(token, from, recipient, amount);
      return;
    }
    if (fn === "approve") {
      const [token, spender, amount, expiration] = a as [Hex, Hex, bigint, number];
      const key = `${sender}|${lc(token)}|${lc(spender)}`;
      const current = this.permit2.get(key) ?? { amount: 0n, expiration: 0, nonce: 0 };
      this.permit2.set(key, { ...current, amount, expiration });
      return;
    }
    throw new Error(`fake Permit2 cannot ${fn}`);
  }

  private async executeSpm(sender: string, fn: string, a: readonly unknown[]): Promise<void> {
    const p = a[0] as SpendPermission;
    const hash = hashSpendPermission(this.chainId, p);
    if (fn === "approveWithSignature") {
      const valid = await verifyTypedData({ ...(spendPermissionTypedData(this.chainId, p) as never), address: p.account, signature: a[1] as Hex });
      if (!valid) throw new Revert("InvalidSignature");
      this.spmApproved.add(hash);
      return;
    }
    if (fn === "revokeAsSpender") {
      if (sender !== lc(p.spender)) throw new Revert("InvalidSender");
      this.spmRevoked.add(hash);
      return;
    }
    if (fn === "spend") {
      if (sender !== lc(p.spender)) throw new Revert("InvalidSender");
      if (!this.spmValid(p, hash)) throw new Revert("UnauthorizedSpendPermission");
      const value = a[1] as bigint;
      const period = this.spmPeriod(p, hash);
      if (period.spend + value > p.allowance) throw new Revert("ExceededSpendPermission");
      this.spmSpend.set(hash, { start: period.start, spend: period.spend + value });
      this.move(p.token, p.account, p.spender, value);
      return;
    }
    throw new Error(`fake SpendPermissionManager cannot ${fn}`);
  }

  private async executeEscrow(sender: string, fn: string, a: readonly unknown[]): Promise<void> {
    const info = a[0] as PaymentInfo;
    const hash = hashPaymentInfo(info, this.chainId);
    const state = this.escrow.get(hash) ?? { has: false, capturable: 0n, refundable: 0n };
    const escrowAddr = COMMERCE_PAYMENTS_V1_1.authCaptureEscrow;
    if (fn !== "reclaim" && sender !== lc(info.operator)) throw new Revert("InvalidSender");
    const collect = async (amount: bigint, collector: string, data: string) => {
      if (lc(collector) !== lc(COMMERCE_PAYMENTS_V1_1.erc3009PaymentCollector)) throw new Revert("unsupported collector in fake");
      const domain = this.tokenDomains[lc(info.token)];
      if (!domain) throw new Revert("token without EIP-3009 domain");
      const typed = erc3009AuthorizationTypedData(info, this.chainId, domain);
      const valid = await verifyTypedData({ ...(typed as never), address: info.payer, signature: data as Hex });
      if (!valid) throw new Revert("invalid ERC-3009 signature");
      if (Number(this.blockTime) >= info.preApprovalExpiry) throw new Revert("AfterPreApprovalExpiry");
      this.move(info.token, info.payer, escrowAddr, amount);
    };
    switch (fn) {
      case "authorize": {
        if (state.has) throw new Revert("PaymentAlreadyCollected");
        const amount = a[1] as bigint;
        await collect(amount, a[2] as string, a[3] as string);
        this.escrow.set(hash, { has: true, capturable: amount, refundable: 0n });
        return;
      }
      case "charge": {
        if (state.has) throw new Revert("PaymentAlreadyCollected");
        const amount = a[1] as bigint;
        await collect(amount, a[2] as string, a[3] as string);
        const fee = a[4] as bigint;
        this.move(info.token, escrowAddr, info.receiver, amount - fee);
        if (fee > 0n) this.move(info.token, escrowAddr, a[5] as string, fee);
        this.escrow.set(hash, { has: true, capturable: 0n, refundable: amount });
        return;
      }
      case "capture": {
        const amount = a[1] as bigint;
        if (Number(this.blockTime) >= info.authorizationExpiry) throw new Revert("AfterAuthorizationExpiry");
        if (state.capturable < amount) throw new Revert("InsufficientAuthorization");
        const fee = a[2] as bigint;
        this.move(info.token, escrowAddr, info.receiver, amount - fee);
        if (fee > 0n) this.move(info.token, escrowAddr, a[3] as string, fee);
        this.escrow.set(hash, { ...state, capturable: state.capturable - amount, refundable: state.refundable + amount });
        return;
      }
      case "void": {
        if (state.capturable === 0n) throw new Revert("ZeroAuthorization");
        this.move(info.token, escrowAddr, info.payer, state.capturable);
        this.escrow.set(hash, { ...state, capturable: 0n });
        return;
      }
      case "refund": {
        const amount = a[1] as bigint;
        if (Number(this.blockTime) >= info.refundExpiry) throw new Revert("AfterRefundExpiry");
        if (state.refundable < amount) throw new Revert("RefundExceedsCapture");
        if (lc(a[2] as string) !== lc(COMMERCE_PAYMENTS_V1_1.operatorRefundCollector)) throw new Revert("InvalidCollectorForOperation");
        this.spendAllowance(info.token, info.operator, COMMERCE_PAYMENTS_V1_1.operatorRefundCollector, amount);
        this.move(info.token, info.operator, info.payer, amount);
        this.escrow.set(hash, { ...state, refundable: state.refundable - amount });
        return;
      }
    }
    throw new Error(`fake escrow cannot ${fn}`);
  }
}

export { zeroAddress };

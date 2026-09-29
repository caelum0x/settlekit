/**
 * Smart-wallet subscriptions via the Base Account SpendPermissionManager
 * (coinbase/spend-permissions, MIT) on Ethereum, Base, Arbitrum and Robinhood
 * Chain (plus Sepolia / Base Sepolia).
 *
 * The buyer's Base Account signs ONE SpendPermission: `allowance` = price per
 * `period` seconds starting at `start`, until `end`, spendable by the
 * SettleKit operator. The permission is recurring by construction — the
 * manager resets the allowance every period, so the operator can never pull
 * more than one price per period even if the charge engine misbehaved.
 *
 * Each pull is `spend(permission, price)` (tokens move account -> operator)
 * followed by an ERC-20 `transfer` to the merchant. Both txs are recorded as
 * steps, so a crash between them forwards exactly once on resume.
 *
 * The typed data here is exactly what `@base-org/account`'s
 * `requestSpendPermission` asks the wallet to sign (same domain, types and
 * field order), so a checkout can use either this payload with
 * `eth_signTypedData_v4` or the SDK helper with the same parameters.
 */
import { hashTypedData, keccak256, type TypedDataDefinition } from "viem";
import { randomBytes } from "node:crypto";
import type { Hex } from "@settlekit/chains";
import { erc20Abi, spendPermissionManagerAbi } from "./abis.js";
import { SPEND_PERMISSION_MANAGER, hasSpendPermissionManager } from "./addresses.js";
import { confirmCharge, type EvmOperator } from "./evm.js";
import { toUnixSeconds } from "./period.js";
import {
  ChargeDeclinedError,
  DeferChargeError,
  IndeterminateChargeError,
  findStep,
  type ChargeProvider,
  type CollectContext,
  type CollectOutcome,
} from "./provider.js";
import type { OnchainSubscription, SpendPermissionGrant, SpendPermissionJson } from "./types.js";

export interface SpendPermission {
  account: Hex;
  spender: Hex;
  token: Hex;
  allowance: bigint;
  period: number;
  start: number;
  end: number;
  salt: bigint;
  extraData: Hex;
}

export const SPEND_PERMISSION_TYPES = {
  SpendPermission: [
    { name: "account", type: "address" },
    { name: "spender", type: "address" },
    { name: "token", type: "address" },
    { name: "allowance", type: "uint160" },
    { name: "period", type: "uint48" },
    { name: "start", type: "uint48" },
    { name: "end", type: "uint48" },
    { name: "salt", type: "uint256" },
    { name: "extraData", type: "bytes" },
  ],
} as const;

export function spendPermissionToJson(permission: SpendPermission): SpendPermissionJson {
  return { ...permission, allowance: permission.allowance.toString(), salt: permission.salt.toString() };
}

export function spendPermissionFromJson(json: SpendPermissionJson): SpendPermission {
  return {
    account: json.account as Hex,
    spender: json.spender as Hex,
    token: json.token as Hex,
    allowance: BigInt(json.allowance),
    period: json.period,
    start: json.start,
    end: json.end,
    salt: BigInt(json.salt),
    extraData: json.extraData as Hex,
  };
}

export function spendPermissionTypedData(chainId: number, permission: SpendPermission): TypedDataDefinition {
  return {
    domain: { name: "Spend Permission Manager", version: "1", chainId, verifyingContract: SPEND_PERMISSION_MANAGER },
    types: SPEND_PERMISSION_TYPES,
    primaryType: "SpendPermission",
    message: permission as unknown as Record<string, unknown>,
  };
}

/** SpendPermissionManager.getHash(permission) — the EIP-712 digest. */
export function hashSpendPermission(chainId: number, permission: SpendPermission): Hex {
  return hashTypedData(spendPermissionTypedData(chainId, permission) as never);
}

export interface SpendPermissionIntentInput {
  account: Hex;
  token: Hex;
  amountPerPeriod: bigint;
  periodSeconds: number;
  anchor: Date;
  periods: number;
  salt?: bigint;
}

export interface PeriodSpend {
  start: number;
  end: number;
  spend: bigint;
}

export class SpendPermissionBilling implements ChargeProvider {
  readonly method = "spend_permission" as const;
  private readonly operators: ReadonlyMap<number, EvmOperator>;

  constructor(operators: readonly EvmOperator[]) {
    for (const operator of operators) {
      if (!hasSpendPermissionManager(operator.chainId)) {
        throw new Error(`SpendPermissionManager is not deployed on chain ${operator.chainId}`);
      }
    }
    this.operators = new Map(operators.map((operator) => [operator.chainId, operator]));
  }

  chainIds(): number[] {
    return [...this.operators.keys()];
  }

  operatorFor(chainId: number): EvmOperator {
    const operator = this.operators.get(chainId);
    if (!operator) throw new Error(`no spend-permission operator configured for chain ${chainId}`);
    return operator;
  }

  /** The permission (and typed data) the buyer's smart wallet signs. */
  createIntent(chainId: number, input: SpendPermissionIntentInput): { permission: SpendPermission; typedData: TypedDataDefinition; hash: Hex } {
    const operator = this.operatorFor(chainId);
    const start = toUnixSeconds(input.anchor);
    const permission: SpendPermission = {
      account: input.account,
      spender: operator.address,
      token: input.token,
      allowance: input.amountPerPeriod,
      period: input.periodSeconds,
      start,
      end: start + input.periodSeconds * input.periods,
      salt: input.salt ?? BigInt(keccak256(randomBytes(32))),
      extraData: "0x",
    };
    return { permission, typedData: spendPermissionTypedData(chainId, permission), hash: hashSpendPermission(chainId, permission) };
  }

  private call(functionName: string, permission: SpendPermission, extra: readonly unknown[] = []) {
    return { address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName, args: [permission, ...extra] };
  }

  async isApproved(chainId: number, permission: SpendPermission): Promise<boolean> {
    return this.operatorFor(chainId).read<boolean>(this.call("isApproved", permission));
  }

  async isValid(chainId: number, permission: SpendPermission): Promise<boolean> {
    return this.operatorFor(chainId).read<boolean>(this.call("isValid", permission));
  }

  async currentPeriod(chainId: number, permission: SpendPermission): Promise<PeriodSpend> {
    const raw = await this.operatorFor(chainId).read<{ start: number | bigint; end: number | bigint; spend: bigint }>(
      this.call("getCurrentPeriod", permission),
    );
    return { start: Number(raw.start), end: Number(raw.end), spend: raw.spend };
  }

  /**
   * Check the smart-wallet signature (ERC-1271, or ERC-6492 for a wallet not
   * yet deployed) and register the permission with `approveWithSignature`.
   */
  async acceptGrant(grant: SpendPermissionGrant): Promise<SpendPermissionGrant> {
    const operator = this.operatorFor(grant.chainId);
    const permission = spendPermissionFromJson(grant.permission);
    if (permission.spender.toLowerCase() !== operator.address.toLowerCase()) {
      throw new ChargeDeclinedError("spend permission spender is not this operator");
    }
    const valid = await operator.verifyTypedData({
      ...spendPermissionTypedData(grant.chainId, permission),
      address: permission.account,
      signature: grant.signature as Hex,
    });
    if (!valid) throw new ChargeDeclinedError("spend permission signature is not valid for the account");
    if (await this.isApproved(grant.chainId, permission)) return grant;
    const hash = await operator.write(this.call("approveWithSignature", permission, [grant.signature as Hex]));
    const receipt = await operator.waitForReceipt(hash);
    if (receipt.status !== "success") throw new ChargeDeclinedError(`approveWithSignature ${hash} reverted`);
    return { ...grant, approveTxHash: hash };
  }

  /** Operator-side revoke (SpendPermissionManager.revokeAsSpender); undefined when already invalid. */
  async revokeAsSpender(grant: SpendPermissionGrant): Promise<Hex | undefined> {
    const operator = this.operatorFor(grant.chainId);
    const permission = spendPermissionFromJson(grant.permission);
    if (!(await this.isValid(grant.chainId, permission))) return undefined;
    const hash = await operator.write(this.call("revokeAsSpender", permission));
    const receipt = await operator.waitForReceipt(hash);
    if (receipt.status !== "success") throw new Error(`revokeAsSpender ${hash} reverted`);
    return hash;
  }

  async collect(subscription: OnchainSubscription, context: CollectContext): Promise<CollectOutcome> {
    const grant = subscription.grant;
    if (grant?.kind !== "spend_permission") throw new ChargeDeclinedError("subscription has no spend permission");
    const operator = this.operatorFor(grant.chainId);
    const permission = spendPermissionFromJson(grant.permission);
    const price = BigInt(subscription.amountPerPeriod);

    const forwarded = findStep(context.charge, "forward");
    if (forwarded !== undefined) {
      const receipt = await operator.getReceipt(forwarded as Hex);
      if (receipt === null) throw new IndeterminateChargeError(`forward ${forwarded} not yet mined`);
      if (receipt.status === "success") return { status: "succeeded", txHash: findStep(context.charge, "spend") ?? forwarded };
    }

    const spent = await this.ensureSpent(operator, grant.chainId, permission, price, context);
    const hash = await operator.write({
      address: permission.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [subscription.payTo as Hex, price],
    });
    await context.recordStep("forward", hash);
    await confirmCharge(operator, hash, "forward to merchant");
    return { status: "succeeded", txHash: spent ?? hash };
  }

  /** Make sure this period's `spend` happened exactly once; returns its tx hash when known. */
  private async ensureSpent(
    operator: EvmOperator,
    chainId: number,
    permission: SpendPermission,
    price: bigint,
    context: CollectContext,
  ): Promise<Hex | undefined> {
    const previous = findStep(context.charge, "spend");
    if (previous !== undefined) {
      const receipt = await operator.getReceipt(previous as Hex);
      if (receipt === null) throw new IndeterminateChargeError(`spend ${previous} not yet mined`);
      if (receipt.status === "success") return previous as Hex;
    }
    if (!(await this.isValid(chainId, permission))) {
      throw new ChargeDeclinedError("spend permission revoked, expired or never approved");
    }
    const period = await this.currentPeriod(chainId, permission);
    const expectedStart = permission.start + context.charge.periodIndex * permission.period;
    if (period.start < expectedStart) throw new DeferChargeError("chain clock has not reached this billing period yet");
    if (period.spend >= price && previous === undefined) {
      // This period was already spent (a crash before the hash was recorded,
      // or a retry after the forward failed): forward only — and only when the
      // operator still holds the spent funds, so a merchant is never paid twice.
      const held = await operator.read<bigint>({ address: permission.token, abi: erc20Abi, functionName: "balanceOf", args: [operator.address] });
      if (held < price) {
        throw new IndeterminateChargeError("period already spent but the operator does not hold the funds; reconcile manually");
      }
      return undefined;
    }
    if (period.spend + price > permission.allowance) throw new ChargeDeclinedError("spend permission allowance exhausted this period");
    const balance = await operator.read<bigint>({ address: permission.token, abi: erc20Abi, functionName: "balanceOf", args: [permission.account] });
    if (balance < price) throw new ChargeDeclinedError("insufficient token balance");
    const hash = await operator.write(this.call("spend", permission, [price]));
    await context.recordStep("spend", hash);
    await confirmCharge(operator, hash, "spend permission spend");
    return hash;
  }
}

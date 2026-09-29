/**
 * EOA subscriptions on every EVM chain via Uniswap Permit2 AllowanceTransfer.
 *
 * The buyer signs ONE PermitSingle granting the SettleKit operator a capped
 * allowance (price x N periods) that expires after the last covered period.
 * The operator registers it with `permit()` and then pulls exactly one
 * period's price per period with `transferFrom(owner, payTo, price, token)`,
 * sending funds straight to the merchant. Period spacing is enforced by the
 * charge engine; the cap and expiry are enforced by Permit2 itself, so a
 * compromised operator can never take more than the buyer signed for.
 *
 * Prerequisite (once per token): the buyer's ERC-20 `approve(Permit2, ...)`.
 * Revocation: the buyer calls Permit2 `approve(token, spender, 0, 0)` or
 * `lockdown`, or revokes the ERC-20 approval; every pull re-reads the chain
 * and declines when the grant no longer covers the period.
 */
import { encodeFunctionData, maxUint256, type TypedDataDefinition } from "viem";
import type { Hex } from "@settlekit/chains";
import { erc20Abi, permit2Abi } from "./abis.js";
import { PERMIT2_ADDRESS, hasPermit2 } from "./addresses.js";
import type { PayerCall } from "./commerce-escrow.js";
import { confirmCharge, type EvmOperator } from "./evm.js";
import { capFor, grantExpiry, toUnixSeconds } from "./period.js";
import {
  ChargeDeclinedError,
  IndeterminateChargeError,
  findStep,
  type ChargeProvider,
  type CollectContext,
  type CollectOutcome,
} from "./provider.js";
import type { OnchainSubscription, Permit2Grant } from "./types.js";

const UINT48_MAX = 2 ** 48 - 1;
const UINT160_MAX = (1n << 160n) - 1n;

export interface PermitSingle {
  details: { token: Hex; amount: bigint; expiration: number; nonce: number };
  spender: Hex;
  sigDeadline: bigint;
}

export function permitSingleTypedData(chainId: number, permit: PermitSingle): TypedDataDefinition {
  return {
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitSingle",
    message: permit as unknown as Record<string, unknown>,
  };
}

export function permitFromGrant(grant: Permit2Grant): PermitSingle {
  return {
    details: { token: grant.token as Hex, amount: BigInt(grant.amount), expiration: grant.expiration, nonce: grant.nonce },
    spender: grant.spender as Hex,
    sigDeadline: BigInt(grant.sigDeadline),
  };
}

export interface Permit2AllowanceState {
  amount: bigint;
  expiration: number;
  nonce: number;
}

export async function readPermit2Allowance(operator: EvmOperator, owner: Hex, token: Hex, spender: Hex): Promise<Permit2AllowanceState> {
  const [amount, expiration, nonce] = await operator.read<readonly [bigint, number | bigint, number | bigint]>({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [owner, token, spender],
  });
  return { amount, expiration: Number(expiration), nonce: Number(nonce) };
}

export interface Permit2IntentInput {
  owner: Hex;
  token: Hex;
  amountPerPeriod: bigint;
  periods: number;
  anchor: Date;
  periodSeconds: number;
  /** Seconds the buyer has to sign + submit (default 1h). */
  signatureTtlSeconds?: number;
  now?: Date;
}

export interface Permit2Intent {
  permit: PermitSingle;
  typedData: TypedDataDefinition;
  /** ERC-20 approval of Permit2 the buyer must send first, if missing. */
  payerCalls: PayerCall[];
}

/** Everything Permit2 needs on one chain, driven by the operator key. */
export class Permit2Billing implements ChargeProvider {
  readonly method = "permit2" as const;
  private readonly operators: ReadonlyMap<number, EvmOperator>;

  constructor(operators: readonly EvmOperator[]) {
    for (const operator of operators) {
      if (!hasPermit2(operator.chainId)) throw new Error(`Permit2 is not deployed on chain ${operator.chainId}`);
    }
    this.operators = new Map(operators.map((operator) => [operator.chainId, operator]));
  }

  chainIds(): number[] {
    return [...this.operators.keys()];
  }

  operatorFor(chainId: number): EvmOperator {
    const operator = this.operators.get(chainId);
    if (!operator) throw new Error(`no Permit2 operator configured for chain ${chainId}`);
    return operator;
  }

  /** Build the PermitSingle the buyer signs (nonce read live from Permit2). */
  async createIntent(chainId: number, input: Permit2IntentInput): Promise<Permit2Intent> {
    const operator = this.operatorFor(chainId);
    const cap = capFor(input.amountPerPeriod, input.periods);
    if (cap > UINT160_MAX) throw new RangeError("Permit2 allowance cap exceeds uint160");
    const expiration = grantExpiry(input.anchor, input.periodSeconds, input.periods);
    if (expiration > UINT48_MAX) throw new RangeError("Permit2 expiration exceeds uint48");
    const current = await readPermit2Allowance(operator, input.owner, input.token, operator.address);
    const now = input.now ?? new Date();
    const permit: PermitSingle = {
      details: { token: input.token, amount: cap, expiration, nonce: current.nonce },
      spender: operator.address,
      sigDeadline: BigInt(toUnixSeconds(now) + (input.signatureTtlSeconds ?? 3_600)),
    };
    const erc20Allowance = await operator.read<bigint>({
      address: input.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.owner, PERMIT2_ADDRESS],
    });
    const payerCalls: PayerCall[] =
      erc20Allowance >= cap
        ? []
        : [
            {
              to: input.token,
              chainId,
              data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, maxUint256] }),
              description: "one-time ERC-20 approval of the Permit2 contract",
            },
          ];
    return { permit, typedData: permitSingleTypedData(chainId, permit), payerCalls };
  }

  /** Verify the buyer's signature and register it onchain with `permit()`. */
  async acceptGrant(grant: Permit2Grant, now: Date = new Date()): Promise<Permit2Grant> {
    const operator = this.operatorFor(grant.chainId);
    if (grant.spender.toLowerCase() !== operator.address.toLowerCase()) {
      throw new ChargeDeclinedError("Permit2 grant spender is not this operator");
    }
    if (BigInt(grant.sigDeadline) < BigInt(toUnixSeconds(now))) throw new ChargeDeclinedError("Permit2 signature deadline has passed");
    const permit = permitFromGrant(grant);
    const valid = await operator.verifyTypedData({
      ...permitSingleTypedData(grant.chainId, permit),
      address: grant.owner as Hex,
      signature: grant.signature as Hex,
    });
    if (!valid) throw new ChargeDeclinedError("Permit2 signature does not match the owner");
    const hash = await this.registerIfNeeded(operator, grant);
    return hash ? { ...grant, permitTxHash: hash } : grant;
  }

  /** Submit `permit()` unless Permit2 already consumed this nonce. */
  private async registerIfNeeded(operator: EvmOperator, grant: Permit2Grant): Promise<Hex | undefined> {
    const current = await readPermit2Allowance(operator, grant.owner as Hex, grant.token as Hex, operator.address);
    if (current.nonce !== grant.nonce) return undefined;
    const hash = await operator.write({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: "permit",
      args: [grant.owner as Hex, permitFromGrant(grant), grant.signature as Hex],
    });
    const receipt = await operator.waitForReceipt(hash);
    if (receipt.status !== "success") throw new ChargeDeclinedError(`Permit2 permit() ${hash} reverted`);
    return hash;
  }

  async collect(subscription: OnchainSubscription, context: CollectContext): Promise<CollectOutcome> {
    const grant = subscription.grant;
    if (grant?.kind !== "permit2") throw new ChargeDeclinedError("subscription has no Permit2 grant");
    const operator = this.operatorFor(grant.chainId);
    const price = BigInt(subscription.amountPerPeriod);

    const previous = findStep(context.charge, "transfer");
    if (previous !== undefined) {
      const receipt = await operator.getReceipt(previous as Hex);
      if (receipt === null) throw new IndeterminateChargeError(`Permit2 transfer ${previous} not yet mined`);
      if (receipt.status === "success") return { status: "succeeded", txHash: previous };
    }

    await this.registerIfNeeded(operator, grant);
    const owner = grant.owner as Hex;
    const token = grant.token as Hex;
    const allowance = await readPermit2Allowance(operator, owner, token, operator.address);
    const expectedRemaining = BigInt(grant.amount) - context.priorCollected;
    if (previous === undefined && allowance.amount === expectedRemaining - price && allowance.amount >= 0n) {
      // A pull for this period landed but its hash was never recorded.
      return { status: "succeeded", note: "reconciled from Permit2 allowance" };
    }
    if (allowance.expiration <= toUnixSeconds(context.now)) throw new ChargeDeclinedError("Permit2 allowance expired");
    if (allowance.amount < price) throw new ChargeDeclinedError("Permit2 allowance revoked or exhausted");

    const [balance, erc20Allowance] = await Promise.all([
      operator.read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
      operator.read<bigint>({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, PERMIT2_ADDRESS] }),
    ]);
    if (erc20Allowance < price) throw new ChargeDeclinedError("ERC-20 approval of Permit2 was revoked");
    if (balance < price) throw new ChargeDeclinedError("insufficient token balance");

    const hash = await operator.write({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: "transferFrom",
      args: [owner, subscription.payTo as Hex, price, token],
    });
    await context.recordStep("transfer", hash);
    await confirmCharge(operator, hash, "Permit2 transferFrom");
    return { status: "succeeded", txHash: hash };
  }
}

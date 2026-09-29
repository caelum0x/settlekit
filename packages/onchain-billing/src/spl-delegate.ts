/**
 * Solana subscriptions via SPL Token delegation.
 *
 * The buyer signs ONE `ApproveChecked` making the SettleKit operator the
 * delegate of their USDC token account for price x N periods. Each period the
 * operator (fee payer + delegate authority) sends a `TransferChecked` of one
 * price from the buyer's account to the merchant's ATA (created idempotently).
 * SPL enforces the cap (delegated_amount decreases on every pull); the charge
 * engine enforces one pull per period; the buyer can `Revoke` at any time.
 */
import {
  address,
  appendTransactionMessageInstructions,
  blockhash as toBlockhash,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getRevokeInstruction,
  getTokenDecoder,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { createKitSolanaRpc, type LatestBlockhash, type SignatureStatus } from "@settlekit/solana";
import {
  ChargeDeclinedError,
  IndeterminateChargeError,
  findStep,
  type ChargeProvider,
  type CollectContext,
  type CollectOutcome,
} from "./provider.js";
import type { OnchainSubscription, SplDelegateGrant } from "./types.js";

export interface SplTokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
}

/** The Solana reads/writes delegate billing needs (tests inject a double). */
export interface SplDelegateRpc {
  getTokenAccount(tokenAccount: string): Promise<SplTokenAccount | null>;
  getLatestBlockhash(): Promise<LatestBlockhash>;
  sendTransaction(base64Transaction: string): Promise<string>;
  getSignatureStatuses(signatures: readonly string[]): Promise<Array<SignatureStatus | null>>;
}

/** Real {@link SplDelegateRpc} over `@solana/kit`. */
export function createKitSplDelegateRpc(rpcUrl: string): SplDelegateRpc {
  const rpc = createSolanaRpc(rpcUrl);
  const base = createKitSolanaRpc(rpcUrl);
  const decoder = getTokenDecoder();
  return {
    async getTokenAccount(tokenAccount) {
      const { value } = await rpc.getAccountInfo(address(tokenAccount), { encoding: "base64", commitment: "confirmed" }).send();
      if (value === null) return null;
      if (value.owner !== TOKEN_PROGRAM_ADDRESS) return null;
      const bytes = Buffer.from(value.data[0], "base64");
      const token = decoder.decode(bytes);
      return {
        mint: token.mint,
        owner: token.owner,
        amount: token.amount,
        delegate: token.delegate.__option === "Some" ? token.delegate.value : null,
        delegatedAmount: token.delegatedAmount,
      };
    },
    getLatestBlockhash: () => base.getLatestBlockhash("confirmed"),
    sendTransaction: (tx) => base.sendTransaction(tx),
    getSignatureStatuses: (signatures) => base.getSignatureStatuses(signatures),
  };
}

export async function ownerTokenAccount(owner: string, mint: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

function compileUnsigned(feePayer: string, instructions: Instruction[], latest: LatestBlockhash): string {
  const payer = createNoopSigner(address(feePayer));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: toBlockhash(latest.blockhash), lastValidBlockHeight: latest.lastValidBlockHeight },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

export interface ApproveTxInput {
  owner: string;
  mint: string;
  delegate: string;
  /** Delegated cap in base units (price x periods). */
  amount: bigint;
  decimals: number;
  latestBlockhash: LatestBlockhash;
}

/** Unsigned `ApproveChecked` the buyer signs and sends (fee payer = buyer). */
export async function buildApproveTx(input: ApproveTxInput): Promise<{ transaction: string; tokenAccount: string }> {
  if (input.amount <= 0n) throw new RangeError("delegated amount must be positive");
  const tokenAccount = await ownerTokenAccount(input.owner, input.mint);
  const instruction = getApproveCheckedInstruction({
    source: address(tokenAccount),
    mint: address(input.mint),
    delegate: address(input.delegate),
    owner: createNoopSigner(address(input.owner)),
    amount: input.amount,
    decimals: input.decimals,
  });
  return { transaction: compileUnsigned(input.owner, [instruction], input.latestBlockhash), tokenAccount };
}

/** Unsigned `Revoke` the buyer can send to cancel on-chain. */
export async function buildRevokeTx(owner: string, mint: string, latestBlockhash: LatestBlockhash): Promise<string> {
  const tokenAccount = await ownerTokenAccount(owner, mint);
  const instruction = getRevokeInstruction({ source: address(tokenAccount), owner: createNoopSigner(address(owner)) });
  return compileUnsigned(owner, [instruction], latestBlockhash);
}

/** A delegate signature that never landed is dead after this long (blockhash expiry). */
const STALE_SIGNATURE_MS = 3 * 60_000;

export interface SplDelegateBillingConfig {
  rpc: SplDelegateRpc;
  /** The operator keypair: delegate authority and fee payer. */
  signer: TransactionSigner;
  cluster: "mainnet" | "devnet";
  pollIntervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class SplDelegateBilling implements ChargeProvider {
  readonly method = "spl_delegate" as const;

  constructor(private readonly config: SplDelegateBillingConfig) {}

  get delegate(): string {
    return this.config.signer.address;
  }

  get cluster(): "mainnet" | "devnet" {
    return this.config.cluster;
  }

  async createIntent(input: Omit<ApproveTxInput, "delegate" | "latestBlockhash">): Promise<{ transaction: string; tokenAccount: string }> {
    const latestBlockhash = await this.config.rpc.getLatestBlockhash();
    return buildApproveTx({ ...input, delegate: this.delegate, latestBlockhash });
  }

  /** Unsigned `Revoke` for the buyer (cancels the delegation onchain). */
  async revokeTx(owner: string, mint: string): Promise<string> {
    return buildRevokeTx(owner, mint, await this.config.rpc.getLatestBlockhash());
  }

  /** Accept a grant once the buyer's approve landed: delegate + cap must match onchain. */
  async acceptGrant(grant: SplDelegateGrant, amountPerPeriod: bigint): Promise<SplDelegateGrant> {
    if (grant.delegate !== this.delegate) throw new ChargeDeclinedError("SPL delegate is not this operator");
    const expected = await ownerTokenAccount(grant.owner, grant.mint);
    if (expected !== grant.tokenAccount) throw new ChargeDeclinedError("token account is not the owner's associated token account");
    const [status] = await this.config.rpc.getSignatureStatuses([grant.approveSignature]);
    if (!status || status.err !== null && status.err !== undefined) {
      throw new ChargeDeclinedError("the approve transaction has not landed successfully");
    }
    const account = await this.config.rpc.getTokenAccount(grant.tokenAccount);
    if (!account) throw new ChargeDeclinedError("buyer token account not found");
    if (account.owner !== grant.owner || account.mint !== grant.mint) throw new ChargeDeclinedError("token account owner/mint mismatch");
    if (account.delegate !== this.delegate) throw new ChargeDeclinedError("token account is not delegated to the operator");
    if (account.delegatedAmount < amountPerPeriod) throw new ChargeDeclinedError("delegated amount is below one period's price");
    return { ...grant, delegatedAmount: account.delegatedAmount.toString() };
  }

  async collect(subscription: OnchainSubscription, context: CollectContext): Promise<CollectOutcome> {
    const grant = subscription.grant;
    if (grant?.kind !== "spl_delegate") throw new ChargeDeclinedError("subscription has no SPL delegation");
    const price = BigInt(subscription.amountPerPeriod);

    const previous = findStep(context.charge, "transfer");
    const previousAt = [...context.charge.steps].reverse().find((s) => s.step === "transfer")?.at;
    if (previous !== undefined) {
      const [status] = await this.config.rpc.getSignatureStatuses([previous]);
      if (status && (status.err === null || status.err === undefined)) return { status: "succeeded", txHash: previous };
      if (status === null) {
        const age = context.now.getTime() - new Date(previousAt ?? 0).getTime();
        if (age < STALE_SIGNATURE_MS) throw new IndeterminateChargeError(`SPL transfer ${previous} not yet visible`);
      }
    }

    const account = await this.config.rpc.getTokenAccount(grant.tokenAccount);
    if (!account) throw new ChargeDeclinedError("buyer token account closed");
    const expectedRemaining = BigInt(grant.delegatedAmount) - context.priorCollected;
    if (previous === undefined && account.delegate === this.delegate && account.delegatedAmount === expectedRemaining - price) {
      return { status: "succeeded", note: "reconciled from SPL delegated amount" };
    }
    if (account.delegate !== this.delegate) throw new ChargeDeclinedError("SPL delegation revoked");
    if (account.delegatedAmount < price) throw new ChargeDeclinedError("SPL delegation exhausted");
    if (account.amount < price) throw new ChargeDeclinedError("insufficient token balance");

    const signature = await this.send(subscription, grant, price);
    await context.recordStep("transfer", signature.signature);
    await this.config.rpc.sendTransaction(signature.wire);
    await this.awaitConfirmation(signature.signature);
    return { status: "succeeded", txHash: signature.signature };
  }

  private async send(subscription: OnchainSubscription, grant: SplDelegateGrant, price: bigint): Promise<{ signature: string; wire: string }> {
    const signer = this.config.signer;
    const mint = address(grant.mint);
    const recipient = address(subscription.payTo);
    const [destination] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const instructions: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destination, owner: recipient, mint }),
      getTransferCheckedInstruction({
        source: address(grant.tokenAccount),
        mint,
        destination,
        authority: signer,
        amount: price,
        decimals: subscription.decimals,
      }),
    ];
    const latest = await this.config.rpc.getLatestBlockhash();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: toBlockhash(latest.blockhash), lastValidBlockHeight: latest.lastValidBlockHeight },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    return { signature: getSignatureFromTransaction(signed), wire: getBase64EncodedWireTransaction(signed) };
  }

  private async awaitConfirmation(signature: string): Promise<void> {
    const deadline = Date.now() + (this.config.maxWaitMs ?? 60_000);
    const interval = this.config.pollIntervalMs ?? 1_500;
    const sleep = this.config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (;;) {
      const [status] = await this.config.rpc.getSignatureStatuses([signature]);
      if (status && status.err !== null && status.err !== undefined) {
        throw new ChargeDeclinedError(`SPL transfer ${signature} failed: ${JSON.stringify(status.err)}`);
      }
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return;
      if (Date.now() >= deadline) throw new IndeterminateChargeError(`SPL transfer ${signature} not confirmed in time`);
      await sleep(interval);
    }
  }
}

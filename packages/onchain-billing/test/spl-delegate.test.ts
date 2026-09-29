import { describe, expect, it } from "vitest";
import {
  generateKeyPairSigner,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { USDC_MINT_DEVNET, type SignatureStatus } from "@settlekit/solana";
import { ChargeDeclinedError, IndeterminateChargeError, type CollectContext } from "../src/provider.js";
import { SplDelegateBilling, buildApproveTx, ownerTokenAccount, type SplDelegateRpc, type SplTokenAccount } from "../src/spl-delegate.js";
import type { OnchainCharge, SplDelegateGrant } from "../src/types.js";
import { T0, subscriptionFixture } from "./helpers.js";

const PRICE = 5_000_000n;
const BUYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MERCHANT_SOL = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";

class FakeSolana implements SplDelegateRpc {
  accounts = new Map<string, SplTokenAccount>();
  statuses = new Map<string, SignatureStatus | null>();
  sent: string[] = [];
  onSend?: (wire: string) => void;
  async getTokenAccount(tokenAccount: string) {
    const found = this.accounts.get(tokenAccount);
    return found ? { ...found } : null;
  }
  async getLatestBlockhash() {
    return { blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 1_000n };
  }
  async sendTransaction(wire: string) {
    this.sent.push(wire);
    this.onSend?.(wire);
    return "sig";
  }
  async getSignatureStatuses(signatures: readonly string[]) {
    return signatures.map((s) => this.statuses.get(s) ?? null);
  }
}

const confirmed: SignatureStatus = { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" };

function ctx(steps: OnchainCharge["steps"] = [], now = T0): CollectContext & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    now,
    priorCollected: 0n,
    charge: {
      id: "och_1", onchainSubscriptionId: "osub_1", periodIndex: 0, network: "solana", method: "spl_delegate", amount: PRICE.toString(),
      status: "pending", attempt: 1, leaseUntil: T0.toISOString(), steps, createdAt: T0.toISOString(), updatedAt: T0.toISOString(),
    },
    recorded,
    async recordStep(step, txHash) {
      recorded.push(`${step}:${txHash}`);
    },
  };
}

async function setup() {
  const signer = await generateKeyPairSigner();
  const rpc = new FakeSolana();
  const billing = new SplDelegateBilling({ rpc, signer, cluster: "devnet", sleep: async () => undefined, maxWaitMs: 50, pollIntervalMs: 1 });
  const tokenAccount = await ownerTokenAccount(BUYER, USDC_MINT_DEVNET);
  rpc.accounts.set(tokenAccount, { mint: USDC_MINT_DEVNET, owner: BUYER, amount: 100_000_000n, delegate: signer.address, delegatedAmount: PRICE * 12n });
  rpc.statuses.set("approve-sig", confirmed);
  const grant: SplDelegateGrant = {
    kind: "spl_delegate", cluster: "devnet", owner: BUYER, tokenAccount, mint: USDC_MINT_DEVNET, delegate: signer.address,
    delegatedAmount: (PRICE * 12n).toString(), approveSignature: "approve-sig",
  };
  const sub = subscriptionFixture({ network: "solana", method: "spl_delegate", payer: BUYER, payTo: MERCHANT_SOL, token: USDC_MINT_DEVNET, amountPerPeriod: PRICE.toString(), grant });
  return { signer, rpc, billing, tokenAccount, grant, sub };
}

describe("SPL delegate billing", () => {
  it("builds an unsigned ApproveChecked for the buyer's ATA with the delegate and cap", async () => {
    const delegate = (await generateKeyPairSigner()).address;
    const built = await buildApproveTx({
      owner: BUYER, mint: USDC_MINT_DEVNET, delegate, amount: PRICE * 12n, decimals: 6,
      latestBlockhash: { blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 1n },
    });
    expect(built.tokenAccount).toBe(await ownerTokenAccount(BUYER, USDC_MINT_DEVNET));
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect(message.staticAccounts[0]).toBe(BUYER); // fee payer = buyer
    const ix = message.instructions[0]!;
    expect(message.staticAccounts[ix.programAddressIndex]).toBe(TOKEN_PROGRAM_ADDRESS);
    const data = ix.data as Uint8Array;
    expect(data[0]).toBe(13); // ApproveChecked discriminator
    expect(new DataView(data.buffer, data.byteOffset + 1, 8).getBigUint64(0, true)).toBe(PRICE * 12n);
    expect(data[9]).toBe(6);
    expect(ix.accountIndices?.map((i) => message.staticAccounts[i])).toEqual([built.tokenAccount, USDC_MINT_DEVNET, delegate, BUYER]);
  });

  it("accepts a grant only when the delegation landed onchain for the operator", async () => {
    const { billing, grant, rpc, tokenAccount } = await setup();
    expect((await billing.acceptGrant(grant, PRICE)).delegatedAmount).toBe((PRICE * 12n).toString());
    rpc.statuses.set("approve-sig", null);
    await expect(billing.acceptGrant(grant, PRICE)).rejects.toThrow(/not landed/);
    rpc.statuses.set("approve-sig", confirmed);
    rpc.accounts.set(tokenAccount, { ...rpc.accounts.get(tokenAccount)!, delegate: BUYER });
    await expect(billing.acceptGrant(grant, PRICE)).rejects.toThrow(/not delegated/);
    await expect(billing.acceptGrant({ ...grant, tokenAccount: MERCHANT_SOL }, PRICE)).rejects.toThrow(/associated token account/);
  });

  it("pulls one period with a delegate-signed TransferChecked and waits for confirmation", async () => {
    const { billing, sub, rpc } = await setup();
    const c = ctx();
    rpc.onSend = () => {
      const sig = c.recorded[0]!.split(":")[1]!;
      rpc.statuses.set(sig, confirmed);
    };
    const outcome = await billing.collect(sub, c);
    expect(outcome.status).toBe("succeeded");
    expect(c.recorded).toHaveLength(1);
    expect(rpc.sent).toHaveLength(1);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(rpc.sent[0]!));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const transfer = message.instructions[1]!;
    expect((transfer.data as Uint8Array)[0]).toBe(12); // TransferChecked
  });

  it("declines when the buyer revoked, exhausted the cap, or lacks balance", async () => {
    const { billing, sub, rpc, tokenAccount } = await setup();
    const base = rpc.accounts.get(tokenAccount)!;
    rpc.accounts.set(tokenAccount, { ...base, delegate: null, delegatedAmount: 0n });
    await expect(billing.collect(sub, ctx())).rejects.toThrow(/revoked/);
    rpc.accounts.set(tokenAccount, { ...base, delegatedAmount: PRICE - 1n });
    await expect(billing.collect(sub, ctx())).rejects.toThrow(ChargeDeclinedError);
    rpc.accounts.set(tokenAccount, { ...base, amount: 1n });
    await expect(billing.collect(sub, ctx())).rejects.toThrow(/insufficient/);
  });

  it("reconciles a recorded signature instead of re-sending", async () => {
    const { billing, sub, rpc } = await setup();
    rpc.statuses.set("prior-sig", confirmed);
    const outcome = await billing.collect(sub, ctx([{ step: "transfer", txHash: "prior-sig", at: T0.toISOString() }]));
    expect(outcome).toEqual({ status: "succeeded", txHash: "prior-sig" });
    expect(rpc.sent).toHaveLength(0);
    await expect(billing.collect(sub, ctx([{ step: "transfer", txHash: "unknown-sig", at: T0.toISOString() }]))).rejects.toThrow(IndeterminateChargeError);
  });

  it("reconciles an unrecorded pull from the delegated amount", async () => {
    const { billing, sub, rpc, tokenAccount } = await setup();
    rpc.accounts.set(tokenAccount, { ...rpc.accounts.get(tokenAccount)!, delegatedAmount: PRICE * 11n });
    expect(await billing.collect(sub, ctx())).toMatchObject({ status: "succeeded", note: expect.stringContaining("reconciled") });
    expect(rpc.sent).toHaveLength(0);
  });

  it("treats an unconfirmed send as indeterminate", async () => {
    const { billing, sub } = await setup();
    await expect(billing.collect(sub, ctx())).rejects.toThrow(IndeterminateChargeError);
  });

  it("builds a buyer Revoke transaction", async () => {
    const { billing } = await setup();
    const wire = await billing.revokeTx(BUYER, USDC_MINT_DEVNET);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect((message.instructions[0]!.data as Uint8Array)[0]).toBe(5); // Revoke
  });
});

/**
 * An in-process settlement ledger and a matched x402 settler/verifier pair.
 *
 * `createLocalSettlement()` returns a {@link Settler} (used by the paying agent)
 * and a {@link PaymentVerifier} (used by the protected endpoint) that share one
 * {@link LocalLedger}. A payment made through the settler is recorded, and the
 * verifier confirms the recorded transfer matches the challenge — so the full
 * pay-and-verify loop runs end to end with no chain, while still tracking real
 * volume for traction metrics. For real testnet USDC, swap in the Circle settler.
 */

import {
  type IsoTimestamp,
  type Money,
  addMoney,
  compareMoney,
  money,
  toIso,
  uuid,
} from "@settlekit/common";
import type {
  PaymentProof,
  PaymentRequirements,
  PaymentVerifier,
  VerifyResult,
} from "@settlekit/x402";
import type { Settler, SettleRequest } from "./types.js";

/** A single recorded transfer in the local ledger. */
export interface LedgerTransfer {
  txHash: string;
  from: string;
  to: string;
  amount: Money;
  network: PaymentRequirements["network"];
  nonce: string;
  productId: string;
  at: IsoTimestamp;
}

/**
 * An append-only in-memory record of settled transfers. Keyed by txHash, with
 * aggregate helpers for traction reporting (total volume, per-recipient totals).
 */
export class LocalLedger {
  private readonly transfers = new Map<string, LedgerTransfer>();

  record(transfer: LedgerTransfer): void {
    this.transfers.set(transfer.txHash, transfer);
  }

  get(txHash: string): LedgerTransfer | undefined {
    return this.transfers.get(txHash);
  }

  all(): readonly LedgerTransfer[] {
    return [...this.transfers.values()];
  }

  count(): number {
    return this.transfers.size;
  }

  /** Total USDC volume that has flowed through this ledger. */
  totalVolume(): Money {
    return this.all().reduce<Money>((sum, t) => addMoney(sum, t.amount), money("0"));
  }

  /** Total USDC received by a given address. */
  receivedBy(address: string): Money {
    return this.all()
      .filter((t) => t.to.toLowerCase() === address.toLowerCase())
      .reduce<Money>((sum, t) => addMoney(sum, t.amount), money("0"));
  }
}

/** A settler + verifier pair backed by a shared {@link LocalLedger}. */
export interface LocalSettlement {
  ledger: LocalLedger;
  settler: Settler;
  verify: PaymentVerifier;
}

/**
 * Build a matched local settler/verifier over a shared ledger. The settler
 * records the transfer and emits a proof; the verifier confirms the proof's
 * txHash names a recorded transfer to the right address for at least the
 * required amount.
 */
export function createLocalSettlement(ledger: LocalLedger = new LocalLedger()): LocalSettlement {
  const settler: Settler = {
    async settle(request: SettleRequest): Promise<PaymentProof> {
      const { requirements, from } = request;
      const txHash = `0xlocal${uuid().replace(/-/g, "")}`;
      ledger.record({
        txHash,
        from,
        to: requirements.payTo,
        amount: money(requirements.amount),
        network: requirements.network,
        nonce: requirements.nonce,
        productId: requirements.productId,
        at: toIso(new Date()),
      });
      return {
        txHash,
        from,
        amount: requirements.amount,
        network: requirements.network,
        nonce: requirements.nonce,
      };
    },
  };

  const verify: PaymentVerifier = async (
    proof: PaymentProof,
    requirements: PaymentRequirements,
  ): Promise<VerifyResult> => {
    const transfer = ledger.get(proof.txHash);
    if (transfer === undefined) {
      return { ok: false, reason: "unknown transaction" };
    }
    if (transfer.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { ok: false, reason: "recipient mismatch" };
    }
    // NOTE: this local verifier intentionally does not bind the challenge nonce.
    // `withSettleKitPayment` regenerates a fresh nonce at verify time unless the
    // server pins a stable `config.nonce`, so a stateless nonce check is not
    // possible here. This loop is for runnable demos/tests; real replay
    // protection comes from the on-chain settler (Circle) + a nonce-tracking
    // verifier on the server.
    if (transfer.network !== requirements.network) {
      return { ok: false, reason: "network mismatch" };
    }
    if (compareMoney(transfer.amount, money(requirements.amount)) < 0) {
      return { ok: false, reason: "underpaid" };
    }
    return { ok: true };
  };

  return { ledger, settler, verify };
}

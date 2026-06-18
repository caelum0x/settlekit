/**
 * The payee registry: resolve an external identity to its payout wallet, and
 * register new mappings. In-memory here; a Pg-backed store (over `lepton_payees`)
 * lives in @settlekit/persistence.
 */

import { type IsoTimestamp, toIso, uuid } from "@settlekit/common";
import type { Payee, PayeeKind, RegisterPayeeInput } from "./types.js";

export interface PayeeRegistry {
  register(input: RegisterPayeeInput): Promise<Payee>;
  resolve(kind: PayeeKind, externalId: string): Promise<Payee | undefined>;
  list(): Promise<Payee[]>;
}

function payeeId(): string {
  return `pye_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

function key(kind: PayeeKind, externalId: string): string {
  return `${kind}|${externalId}`;
}

export class InMemoryPayeeRegistry implements PayeeRegistry {
  private readonly byKey = new Map<string, Payee>();
  private readonly now: () => IsoTimestamp;

  constructor(now: () => Date = () => new Date()) {
    this.now = () => toIso(now());
  }

  async register(input: RegisterPayeeInput): Promise<Payee> {
    const k = key(input.kind, input.externalId);
    const existing = this.byKey.get(k);
    const payee: Payee = {
      id: existing?.id ?? payeeId(),
      kind: input.kind,
      externalId: input.externalId,
      wallet: input.wallet,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      createdAt: existing?.createdAt ?? this.now(),
    };
    this.byKey.set(k, payee);
    return payee;
  }

  async resolve(kind: PayeeKind, externalId: string): Promise<Payee | undefined> {
    return this.byKey.get(key(kind, externalId));
  }

  async list(): Promise<Payee[]> {
    return [...this.byKey.values()];
  }
}

/**
 * Resolve an external identity to a wallet, falling back to a default (e.g. an
 * unclaimed-earnings escrow wallet) when the payee is not yet registered.
 */
export async function walletFor(
  registry: PayeeRegistry,
  kind: PayeeKind,
  externalId: string,
  fallbackWallet?: string,
): Promise<string | undefined> {
  const payee = await registry.resolve(kind, externalId);
  return payee?.wallet ?? fallbackWallet;
}

/**
 * Postgres-backed {@link PayeeRegistry} over `lepton_payees`. The canonical
 * {@link Payee} lives in `metadata.__doc`; kind/external_id/wallet are projected
 * (with a unique index on kind+external_id) for resolution.
 */

import { and, eq, type Database, leptonPayees } from "@settlekit/database";
import { toIso, uuid } from "@settlekit/common";
import type { Payee, PayeeKind, PayeeRegistry, RegisterPayeeInput } from "@settlekit/payee-registry";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgPayeeRegistry implements PayeeRegistry {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: RegisterPayeeInput): Promise<Payee> {
    const existing = await this.resolve(input.kind, input.externalId);
    const payee: Payee = {
      id: existing?.id ?? `pye_${uuid().replace(/-/g, "").slice(0, 24)}`,
      kind: input.kind,
      externalId: input.externalId,
      wallet: input.wallet,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      createdAt: existing?.createdAt ?? toIso(this.now()),
    };
    const projection = {
      kind: payee.kind,
      externalId: payee.externalId,
      wallet: payee.wallet,
      metadata: packDoc(payee),
      createdAt: new Date(payee.createdAt),
    };
    await this.db
      .insert(leptonPayees)
      .values({ id: payee.id, ...projection })
      .onConflictDoUpdate({ target: [leptonPayees.kind, leptonPayees.externalId], set: projection });
    return payee;
  }

  async resolve(kind: PayeeKind, externalId: string): Promise<Payee | undefined> {
    const rows = await this.db
      .select({ metadata: leptonPayees.metadata })
      .from(leptonPayees)
      .where(and(eq(leptonPayees.kind, kind), eq(leptonPayees.externalId, externalId)))
      .limit(1);
    return unpackDoc<Payee>(rows[0]) ?? undefined;
  }

  async list(): Promise<Payee[]> {
    const rows = await this.db.select({ metadata: leptonPayees.metadata }).from(leptonPayees);
    return unpackDocs<Payee>(rows);
  }
}

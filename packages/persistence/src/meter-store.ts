/**
 * Postgres-backed {@link MeterStore} (@settlekit/usage) over the shared
 * `usage_meters` + `credit_balances` tables. The canonical `UsageMeter` /
 * `CreditBalance` documents live in `metadata.__doc`; FK columns project the
 * seeded defaults (the real customer/product ids live in the document, and the
 * by-field lookups filter the unpacked documents).
 */
import {
  eq,
  packDoc,
  unpackDoc,
  unpackDocs,
  type Database,
  usageMeters,
  creditBalances,
} from "@settlekit/database";
import type { CreditBalance, UsageMeter } from "@settlekit/common";
import type { MeterStore } from "@settlekit/usage";
import { DEFAULT_MERCHANT_ID, DEFAULT_CUSTOMER_ID } from "./seed.js";

export class PgMeterStore implements MeterStore {
  constructor(private readonly db: Database) {}

  // --- usage meters -----------------------------------------------------

  async putMeter(meter: UsageMeter): Promise<UsageMeter> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: meter.metric,
      eventName: meter.metric,
      aggregation: "sum",
      metadata: packDoc(meter),
    };
    await this.db
      .insert(usageMeters)
      .values({ id: meter.id, ...projection })
      .onConflictDoUpdate({ target: usageMeters.id, set: projection });
    return meter;
  }

  async getMeter(id: string): Promise<UsageMeter | null> {
    const rows = await this.db
      .select({ metadata: usageMeters.metadata })
      .from(usageMeters)
      .where(eq(usageMeters.id, id))
      .limit(1);
    return unpackDoc<UsageMeter>(rows[0]);
  }

  async findMeter(
    customerId: string,
    productId: string,
    metric: string,
    periodStart: string,
  ): Promise<UsageMeter | null> {
    const rows = await this.db.select({ metadata: usageMeters.metadata }).from(usageMeters);
    const match = unpackDocs<UsageMeter>(rows).find(
      (m) =>
        m.customerId === customerId &&
        m.productId === productId &&
        m.metric === metric &&
        m.periodStart === periodStart,
    );
    return match ?? null;
  }

  async listMetersForCustomer(customerId: string): Promise<UsageMeter[]> {
    const rows = await this.db.select({ metadata: usageMeters.metadata }).from(usageMeters);
    return unpackDocs<UsageMeter>(rows).filter((m) => m.customerId === customerId);
  }

  // --- credit balances --------------------------------------------------

  async putBalance(balance: CreditBalance): Promise<CreditBalance> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: DEFAULT_CUSTOMER_ID,
      balance: String(balance.creditsRemaining),
      reserved: "0",
      metadata: packDoc(balance),
    };
    await this.db
      .insert(creditBalances)
      .values({ id: balance.id, ...projection })
      .onConflictDoUpdate({ target: creditBalances.id, set: projection });
    return balance;
  }

  async getBalance(id: string): Promise<CreditBalance | null> {
    const rows = await this.db
      .select({ metadata: creditBalances.metadata })
      .from(creditBalances)
      .where(eq(creditBalances.id, id))
      .limit(1);
    return unpackDoc<CreditBalance>(rows[0]);
  }

  async findBalance(customerId: string, productId: string): Promise<CreditBalance | null> {
    const rows = await this.db.select({ metadata: creditBalances.metadata }).from(creditBalances);
    const match = unpackDocs<CreditBalance>(rows).find(
      (b) => b.customerId === customerId && b.productId === productId,
    );
    return match ?? null;
  }
}

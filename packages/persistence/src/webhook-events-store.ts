/**
 * Postgres-backed {@link EntityStore} for webhook events.
 * Canonical WebhookEvent in `metadata.__doc`; typed columns projected for querying.
 *
 * The WebhookEvent domain type carries `organizationId` (not `merchantId`), but
 * `webhook_events` has a NOT NULL `merchant_id` FK — so we project
 * {@link DEFAULT_MERCHANT_ID}. `data` maps to the `payload` jsonb column.
 */
import { eq, type Database, webhookEvents } from "@settlekit/database";
import type { WebhookEvent } from "@settlekit/common";
import type { EntityStore } from "./entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export class PgWebhookEventStore implements EntityStore<WebhookEvent> {
  constructor(private readonly db: Database) {}

  // webhook_events has no `metadata` column; the canonical document is stored
  // in the `payload` jsonb column instead (aliased to `metadata` on read so the
  // shared codec works unchanged).
  async save(entity: WebhookEvent): Promise<WebhookEvent> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      type: entity.type,
      payload: packDoc(entity),
    };
    await this.db
      .insert(webhookEvents)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: webhookEvents.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    const rows = await this.db
      .select({ metadata: webhookEvents.payload })
      .from(webhookEvents)
      .where(eq(webhookEvents.id, id))
      .limit(1);
    return unpackDoc<WebhookEvent>(rows[0]);
  }

  async list(predicate?: (entity: WebhookEvent) => boolean): Promise<WebhookEvent[]> {
    const rows = await this.db
      .select({ metadata: webhookEvents.payload })
      .from(webhookEvents);
    const all = unpackDocs<WebhookEvent>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(webhookEvents)
      .where(eq(webhookEvents.id, id))
      .returning({ id: webhookEvents.id });
    return res.length > 0;
  }
}

/**
 * Postgres-backed {@link EntityStore} for webhook endpoints.
 * Canonical WebhookEndpoint in `metadata.__doc`; typed columns projected for querying.
 *
 * The WebhookEndpoint domain type carries `organizationId` (not `merchantId`),
 * but `webhook_endpoints` has a NOT NULL `merchant_id` FK — so we project
 * {@link DEFAULT_MERCHANT_ID}. `active` maps to the `status` column.
 */
import { eq, type Database, webhookEndpoints } from "@settlekit/database";
import type { WebhookEndpoint } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgWebhookEndpointStore implements EntityStore<WebhookEndpoint> {
  constructor(private readonly db: Database) {}

  async save(entity: WebhookEndpoint): Promise<WebhookEndpoint> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      url: entity.url,
      secret: entity.signingSecret,
      enabledEvents: entity.enabledEvents,
      status: entity.active ? "active" : "disabled",
      metadata: packDoc(entity),
    };
    await this.db
      .insert(webhookEndpoints)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: webhookEndpoints.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<WebhookEndpoint | null> {
    const rows = await this.db
      .select({ metadata: webhookEndpoints.metadata })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return unpackDoc<WebhookEndpoint>(rows[0]);
  }

  async list(
    predicate?: (entity: WebhookEndpoint) => boolean,
  ): Promise<WebhookEndpoint[]> {
    const rows = await this.db
      .select({ metadata: webhookEndpoints.metadata })
      .from(webhookEndpoints);
    const all = unpackDocs<WebhookEndpoint>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .returning({ id: webhookEndpoints.id });
    return res.length > 0;
  }
}

DROP INDEX IF EXISTS "payments_tx_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_tx_hash_unique_idx" ON "payments" USING btree ("tx_hash") WHERE "payments"."tx_hash" IS NOT NULL;

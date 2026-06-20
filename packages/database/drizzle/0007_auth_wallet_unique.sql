DROP INDEX IF EXISTS "auth_accounts_wallet_address_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_wallet_address_idx" ON "auth_accounts" USING btree ("wallet_address");

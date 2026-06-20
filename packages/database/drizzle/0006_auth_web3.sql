ALTER TABLE "auth_accounts" ADD COLUMN "wallet_address" text;--> statement-breakpoint
CREATE TABLE "auth_wallet_nonces" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_wallet_nonces_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE INDEX "auth_accounts_wallet_address_idx" ON "auth_accounts" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "auth_wallet_nonces_nonce_idx" ON "auth_wallet_nonces" USING btree ("nonce");

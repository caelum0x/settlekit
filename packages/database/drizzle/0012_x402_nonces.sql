CREATE TABLE IF NOT EXISTS "x402_nonces" (
	"key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x402_nonces_state_idx" ON "x402_nonces" USING btree ("state");

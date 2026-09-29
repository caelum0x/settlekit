CREATE TABLE IF NOT EXISTS "onchain_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text NOT NULL,
	"network" text NOT NULL,
	"method" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onchain_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"onchain_subscription_id" text NOT NULL,
	"period_index" integer NOT NULL,
	"status" text NOT NULL,
	"lease_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onchain_charges_subscription_period_unique" UNIQUE("onchain_subscription_id","period_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onchain_escrow_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_subscriptions_org_idx" ON "onchain_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_subscriptions_customer_idx" ON "onchain_subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_subscriptions_status_idx" ON "onchain_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_charges_status_idx" ON "onchain_charges" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_escrow_payments_org_idx" ON "onchain_escrow_payments" USING btree ("organization_id");

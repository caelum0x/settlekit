CREATE TABLE "agent_reputations" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_average" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"file_id" text NOT NULL,
	"customer_id" text,
	"download_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"downloads_remaining" integer,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saas_seats" DROP CONSTRAINT "saas_seats_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_usage_events" DROP CONSTRAINT "agent_usage_events_agent_buyer_id_agent_buyers_id_fk";
--> statement-breakpoint
ALTER TABLE "saas_seats" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage_events" ALTER COLUMN "agent_buyer_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_reputations_service_id_idx" ON "agent_reputations" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "download_grants_file_id_idx" ON "download_grants" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "download_grants_download_token_idx" ON "download_grants" USING btree ("download_token");
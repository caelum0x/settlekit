CREATE TABLE "worker_delivery_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"payment_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_dunning_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_dunning_attempts_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "worker_email_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ledger_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_email_ledger_kind_key_unique" UNIQUE("kind","ledger_key")
);
--> statement-breakpoint
CREATE TABLE "worker_webhook_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "worker_delivery_queue_status_idx" ON "worker_delivery_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "worker_delivery_queue_payment_id_idx" ON "worker_delivery_queue" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "worker_dunning_attempts_subscription_id_idx" ON "worker_dunning_attempts" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "worker_webhook_jobs_status_idx" ON "worker_webhook_jobs" USING btree ("status");
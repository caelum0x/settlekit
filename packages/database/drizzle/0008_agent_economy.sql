CREATE TABLE "agent_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"metadata_uri" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester" text NOT NULL,
	"worker" text NOT NULL,
	"amount" text,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_registry_org_idx" ON "agent_registry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_registry_owner_idx" ON "agent_registry" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "agent_jobs_org_idx" ON "agent_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_status_idx" ON "agent_jobs" USING btree ("status");

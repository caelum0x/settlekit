CREATE TABLE "escrow_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_task_id" text NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"amount" text NOT NULL,
	"reason" text,
	"tx_hash" text,
	"refunded_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_task_id" text NOT NULL,
	"submission_id" text,
	"decision" text NOT NULL,
	"notes" text,
	"reviewed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escrow_refunds" ADD CONSTRAINT "escrow_refunds_escrow_task_id_escrow_tasks_id_fk" FOREIGN KEY ("escrow_task_id") REFERENCES "public"."escrow_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_reviews" ADD CONSTRAINT "escrow_reviews_escrow_task_id_escrow_tasks_id_fk" FOREIGN KEY ("escrow_task_id") REFERENCES "public"."escrow_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_reviews" ADD CONSTRAINT "escrow_reviews_submission_id_escrow_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."escrow_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escrow_refunds_escrow_task_id_idx" ON "escrow_refunds" USING btree ("escrow_task_id");--> statement-breakpoint
CREATE INDEX "escrow_reviews_escrow_task_id_idx" ON "escrow_reviews" USING btree ("escrow_task_id");
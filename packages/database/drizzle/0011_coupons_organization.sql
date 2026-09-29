ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupons_organization_id_idx" ON "coupons" USING btree ("organization_id");

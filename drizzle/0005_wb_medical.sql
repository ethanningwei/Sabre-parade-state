CREATE TYPE "public"."wb_onens" AS ENUM('NA', 'OWED', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."wb_seen_by" AS ENUM('MO', 'CIVILIAN');--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "mc_category" text;--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "evidence_file_id" text;--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "onens" "wb_onens" DEFAULT 'NA' NOT NULL;--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "seen_by" "wb_seen_by";--> statement-breakpoint
ALTER TABLE "wb_record" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "wb_record_parent_idx" ON "wb_record" USING btree ("parent_id");
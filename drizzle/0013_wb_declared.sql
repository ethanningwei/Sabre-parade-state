ALTER TYPE "public"."wb_created_via" ADD VALUE 'DECLARED';--> statement-breakpoint
ALTER TABLE "wb_member" ADD COLUMN "statuses_asked_at" timestamp with time zone;
CREATE TYPE "public"."wb_conduct_kind" AS ENUM('STRENGTH', 'NAMED');--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "kind" "wb_conduct_kind" DEFAULT 'STRENGTH' NOT NULL;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD COLUMN "message_id" integer;
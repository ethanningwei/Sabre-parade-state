CREATE TYPE "public"."wb_conduct_state" AS ENUM('OPEN', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."wb_coy_chat_kind" AS ENUM('COMMANDERS');--> statement-breakpoint
CREATE TABLE "wb_conduct" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coy_id" uuid NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"report_by" text NOT NULL,
	"state" "wb_conduct_state" DEFAULT 'OPEN' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wb_conduct_camp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conduct_id" uuid NOT NULL,
	"camp_id" uuid NOT NULL,
	"reported_at" timestamp with time zone,
	"reported_by" uuid,
	"going" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"chat_id" bigint,
	"thread_id" bigint,
	"message_id" integer,
	"nudged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wb_conduct_man" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conduct_camp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"rank" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"going" boolean NOT NULL,
	"reason" text,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "wb_coy_chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coy_id" uuid NOT NULL,
	"kind" "wb_coy_chat_kind" NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" bigint,
	"chat_title" text DEFAULT '' NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD CONSTRAINT "wb_conduct_coy_id_coy_id_fk" FOREIGN KEY ("coy_id") REFERENCES "public"."coy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD CONSTRAINT "wb_conduct_created_by_wb_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct" ADD CONSTRAINT "wb_conduct_cancelled_by_wb_member_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct_camp" ADD CONSTRAINT "wb_conduct_camp_conduct_id_wb_conduct_id_fk" FOREIGN KEY ("conduct_id") REFERENCES "public"."wb_conduct"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct_camp" ADD CONSTRAINT "wb_conduct_camp_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct_camp" ADD CONSTRAINT "wb_conduct_camp_reported_by_wb_member_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct_man" ADD CONSTRAINT "wb_conduct_man_conduct_camp_id_wb_conduct_camp_id_fk" FOREIGN KEY ("conduct_camp_id") REFERENCES "public"."wb_conduct_camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_conduct_man" ADD CONSTRAINT "wb_conduct_man_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_coy_chat" ADD CONSTRAINT "wb_coy_chat_coy_id_coy_id_fk" FOREIGN KEY ("coy_id") REFERENCES "public"."coy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_coy_chat" ADD CONSTRAINT "wb_coy_chat_linked_by_wb_member_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_conduct_date_idx" ON "wb_conduct" USING btree ("coy_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_conduct_camp_uq" ON "wb_conduct_camp" USING btree ("conduct_id","camp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_conduct_man_uq" ON "wb_conduct_man" USING btree ("conduct_camp_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_coy_chat_uq" ON "wb_coy_chat" USING btree ("coy_id","kind");
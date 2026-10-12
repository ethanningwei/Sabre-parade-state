CREATE TYPE "public"."wb_shift_kind" AS ENUM('CYCLE', 'WEEKLY', 'ALWAYS');--> statement-breakpoint
CREATE TABLE "wb_min_manning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL,
	"total" integer NOT NULL,
	"gc" integer,
	"st_cbt" integer,
	"st_svc" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_min_manning_camp_uq" UNIQUE("camp_id")
);
--> statement-breakpoint
CREATE TABLE "wb_shift_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"on" boolean NOT NULL,
	"by" uuid,
	"matched" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_shift_pattern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL,
	"kind" "wb_shift_kind" NOT NULL,
	"on_days" integer DEFAULT 3 NOT NULL,
	"off_days" integer DEFAULT 3 NOT NULL,
	"anchor_date" date,
	"hoto_time" text DEFAULT '2100' NOT NULL,
	"weekday_mask" integer DEFAULT 31 NOT NULL,
	"holidays_off" boolean DEFAULT true NOT NULL,
	"both_on_allowed" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_shift_pattern_camp_uq" UNIQUE("camp_id")
);
--> statement-breakpoint
ALTER TABLE "wb_min_manning" ADD CONSTRAINT "wb_min_manning_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_min_manning" ADD CONSTRAINT "wb_min_manning_updated_by_wb_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_event" ADD CONSTRAINT "wb_shift_event_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_event" ADD CONSTRAINT "wb_shift_event_by_wb_member_id_fk" FOREIGN KEY ("by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_pattern" ADD CONSTRAINT "wb_shift_pattern_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_pattern" ADD CONSTRAINT "wb_shift_pattern_updated_by_wb_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_shift_event_camp_at_idx" ON "wb_shift_event" USING btree ("camp_id","at");
CREATE TYPE "public"."wb_phase_kind" AS ENUM('VIGILANCE', 'ROT');--> statement-breakpoint
ALTER TYPE "public"."wb_role" ADD VALUE 'SC' BEFORE 'PS';--> statement-breakpoint
CREATE TABLE "wb_changeover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coy_id" uuid NOT NULL,
	"to" "wb_phase_kind" NOT NULL,
	"switched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"switched_by" uuid,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"log" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_draft_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "wb_role" NOT NULL,
	"person_id" uuid NOT NULL,
	"platoon_id" uuid,
	"section_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_draft_grant_one_scope" CHECK (("wb_draft_grant"."platoon_id" is null) <> ("wb_draft_grant"."section_id" is null))
);
--> statement-breakpoint
CREATE TABLE "wb_draft_placement" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"placed_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_draft_platoon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"subunit_id" uuid,
	"chat_id" bigint,
	"thread_id" bigint,
	"chat_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_draft_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platoon_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"camp_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_phase" (
	"coy_id" uuid PRIMARY KEY NOT NULL,
	"phase" "wb_phase_kind" DEFAULT 'VIGILANCE' NOT NULL,
	"changeover_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "wb_changeover" ADD CONSTRAINT "wb_changeover_coy_id_coy_id_fk" FOREIGN KEY ("coy_id") REFERENCES "public"."coy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_changeover" ADD CONSTRAINT "wb_changeover_switched_by_wb_member_id_fk" FOREIGN KEY ("switched_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_changeover" ADD CONSTRAINT "wb_changeover_undone_by_wb_member_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_grant" ADD CONSTRAINT "wb_draft_grant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_grant" ADD CONSTRAINT "wb_draft_grant_platoon_id_wb_draft_platoon_id_fk" FOREIGN KEY ("platoon_id") REFERENCES "public"."wb_draft_platoon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_grant" ADD CONSTRAINT "wb_draft_grant_section_id_wb_draft_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wb_draft_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_placement" ADD CONSTRAINT "wb_draft_placement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_placement" ADD CONSTRAINT "wb_draft_placement_section_id_wb_draft_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wb_draft_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_placement" ADD CONSTRAINT "wb_draft_placement_placed_by_wb_member_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_platoon" ADD CONSTRAINT "wb_draft_platoon_coy_id_coy_id_fk" FOREIGN KEY ("coy_id") REFERENCES "public"."coy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_platoon" ADD CONSTRAINT "wb_draft_platoon_subunit_id_subunit_id_fk" FOREIGN KEY ("subunit_id") REFERENCES "public"."subunit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_section" ADD CONSTRAINT "wb_draft_section_platoon_id_wb_draft_platoon_id_fk" FOREIGN KEY ("platoon_id") REFERENCES "public"."wb_draft_platoon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_draft_section" ADD CONSTRAINT "wb_draft_section_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_phase" ADD CONSTRAINT "wb_phase_coy_id_coy_id_fk" FOREIGN KEY ("coy_id") REFERENCES "public"."coy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_phase" ADD CONSTRAINT "wb_phase_changeover_id_wb_changeover_id_fk" FOREIGN KEY ("changeover_id") REFERENCES "public"."wb_changeover"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_phase" ADD CONSTRAINT "wb_phase_updated_by_wb_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_changeover_coy_idx" ON "wb_changeover" USING btree ("coy_id","switched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_draft_grant_uq" ON "wb_draft_grant" USING btree ("role","person_id",coalesce("platoon_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("section_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "wb_draft_placement_section_idx" ON "wb_draft_placement" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_draft_platoon_name_uq" ON "wb_draft_platoon" USING btree ("coy_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_draft_section_name_uq" ON "wb_draft_section" USING btree ("platoon_id","name");
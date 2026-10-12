CREATE TYPE "public"."wb_member_source" AS ENUM('ROSTER', 'SELF');--> statement-breakpoint
CREATE TYPE "public"."wb_role" AS ENUM('GC', 'PS', 'PC', '2IC', 'OC', 'CSM', 'ASA', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."wb_stayout" AS ENUM('NONE', 'PERM', 'TEMP');--> statement-breakpoint
CREATE TABLE "wb_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"via" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_commander_chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subunit_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" bigint,
	"chat_title" text DEFAULT '' NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_commander_chat_subunit_uq" UNIQUE("subunit_id")
);
--> statement-breakpoint
CREATE TABLE "wb_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "wb_role" NOT NULL,
	"subunit_id" uuid,
	"camp_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_grant_one_scope" CHECK ("wb_grant"."subunit_id" is null or "wb_grant"."camp_id" is null)
);
--> statement-breakpoint
CREATE TABLE "wb_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"tg_username" text,
	"tg_name" text DEFAULT '' NOT NULL,
	"person_id" uuid,
	"full_name" text,
	"nric4" text,
	"ord_date" date,
	"leave_left" integer,
	"stayout" "wb_stayout" DEFAULT 'NONE' NOT NULL,
	"stayout_until" date,
	"source" "wb_member_source",
	"self_name" text,
	"self_rank" text,
	"self_role" text,
	"self_camp_id" uuid,
	"registered_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_member_telegram_user_id_uq" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "wb_audit" ADD CONSTRAINT "wb_audit_member_id_wb_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_commander_chat" ADD CONSTRAINT "wb_commander_chat_subunit_id_subunit_id_fk" FOREIGN KEY ("subunit_id") REFERENCES "public"."subunit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_commander_chat" ADD CONSTRAINT "wb_commander_chat_linked_by_wb_member_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_grant" ADD CONSTRAINT "wb_grant_member_id_wb_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wb_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_grant" ADD CONSTRAINT "wb_grant_subunit_id_subunit_id_fk" FOREIGN KEY ("subunit_id") REFERENCES "public"."subunit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_grant" ADD CONSTRAINT "wb_grant_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_grant" ADD CONSTRAINT "wb_grant_granted_by_wb_member_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_member" ADD CONSTRAINT "wb_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_member" ADD CONSTRAINT "wb_member_self_camp_id_camp_id_fk" FOREIGN KEY ("self_camp_id") REFERENCES "public"."camp"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_audit_at_idx" ON "wb_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "wb_audit_entity_idx" ON "wb_audit" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_grant_uq" ON "wb_grant" USING btree ("member_id","role",coalesce("subunit_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("camp_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "wb_grant_member_idx" ON "wb_grant" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_member_person_uq" ON "wb_member" USING btree ("person_id") WHERE "wb_member"."person_id" is not null;
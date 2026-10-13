CREATE TYPE "public"."wb_assignment_state" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."wb_assignment_type" AS ENUM('EXTRA', 'RF', 'SOL');--> statement-breakpoint
CREATE TYPE "public"."wb_rf_role" AS ENUM('GC', 'ST CBT', 'ST SVC', 'ANY');--> statement-breakpoint
CREATE TYPE "public"."wb_rf_state" AS ENUM('OPEN', 'FILLED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "wb_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "wb_assignment_type" NOT NULL,
	"camp_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"rf_request_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"state" "wb_assignment_state" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "wb_assignment_range" CHECK ("wb_assignment"."end_at" > "wb_assignment"."start_at")
);
--> statement-breakpoint
CREATE TABLE "wb_rf_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rf_request_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" bigint,
	"message_id" integer NOT NULL,
	"own" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_rf_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL,
	"role" "wb_rf_role" NOT NULL,
	"need" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"raised_by" uuid,
	"state" "wb_rf_state" DEFAULT 'OPEN' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_rf_request_range" CHECK ("wb_rf_request"."end_at" > "wb_rf_request"."start_at"),
	CONSTRAINT "wb_rf_request_need" CHECK ("wb_rf_request"."need" > 0)
);
--> statement-breakpoint
ALTER TABLE "wb_assignment" ADD CONSTRAINT "wb_assignment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_assignment" ADD CONSTRAINT "wb_assignment_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_assignment" ADD CONSTRAINT "wb_assignment_rf_request_id_wb_rf_request_id_fk" FOREIGN KEY ("rf_request_id") REFERENCES "public"."wb_rf_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_assignment" ADD CONSTRAINT "wb_assignment_created_by_wb_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_assignment" ADD CONSTRAINT "wb_assignment_cancelled_by_wb_member_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_rf_card" ADD CONSTRAINT "wb_rf_card_rf_request_id_wb_rf_request_id_fk" FOREIGN KEY ("rf_request_id") REFERENCES "public"."wb_rf_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_rf_request" ADD CONSTRAINT "wb_rf_request_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_rf_request" ADD CONSTRAINT "wb_rf_request_raised_by_wb_member_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_rf_request" ADD CONSTRAINT "wb_rf_request_closed_by_wb_member_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_assignment_person_range_idx" ON "wb_assignment" USING btree ("person_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "wb_assignment_request_idx" ON "wb_assignment" USING btree ("rf_request_id");--> statement-breakpoint
CREATE INDEX "wb_rf_card_request_idx" ON "wb_rf_card" USING btree ("rf_request_id");--> statement-breakpoint
CREATE INDEX "wb_rf_request_state_idx" ON "wb_rf_request" USING btree ("state","start_at");
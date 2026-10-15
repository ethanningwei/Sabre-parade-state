CREATE TYPE "public"."wb_claim_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."wb_claim_vehicle" AS ENUM('PRIVATE HIRE VEHICLE', 'TAXI', 'BUS', 'MRT');--> statement-breakpoint
CREATE TABLE "wb_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"member_id" uuid,
	"vehicle" "wb_claim_vehicle" NOT NULL,
	"trip_date" date NOT NULL,
	"start_place" text NOT NULL,
	"end_place" text NOT NULL,
	"reason" text NOT NULL,
	"round_trip" boolean NOT NULL,
	"rank" text NOT NULL,
	"sheet_name" text NOT NULL,
	"platoon" text NOT NULL,
	"requested" text NOT NULL,
	"state" "wb_claim_state" DEFAULT 'PENDING' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	"told_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"sheet_tab" text,
	"sheet_row" integer,
	"export_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wb_claim" ADD CONSTRAINT "wb_claim_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_claim" ADD CONSTRAINT "wb_claim_member_id_wb_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_claim_person_idx" ON "wb_claim" USING btree ("person_id","trip_date");--> statement-breakpoint
CREATE INDEX "wb_claim_state_idx" ON "wb_claim" USING btree ("state","trip_date");--> statement-breakpoint
CREATE INDEX "wb_claim_batch_idx" ON "wb_claim" USING btree ("batch_id");
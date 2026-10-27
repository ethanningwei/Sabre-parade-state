CREATE TYPE "public"."wb_stayout_night_state" AS ENUM('CONFIRMED', 'STAYING_IN');--> statement-breakpoint
CREATE TABLE "wb_stayout_night" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"night" date NOT NULL,
	"state" "wb_stayout_night_state" NOT NULL,
	"by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wb_projection" ADD COLUMN "stayout_night" date;--> statement-breakpoint
ALTER TABLE "wb_stayout_night" ADD CONSTRAINT "wb_stayout_night_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_stayout_night" ADD CONSTRAINT "wb_stayout_night_by_wb_member_id_fk" FOREIGN KEY ("by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wb_stayout_night_uq" ON "wb_stayout_night" USING btree ("person_id","night");
CREATE TYPE "public"."wb_projection_close" AS ENUM('VOID', 'BACK', 'REPLACED', 'STOOD_DOWN', 'BY_HAND', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."wb_projection_kind" AS ENUM('ABSENCE', 'DUTY', 'SHIFT');--> statement-breakpoint
CREATE TABLE "wb_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "wb_projection_kind" NOT NULL,
	"person_id" uuid,
	"record_id" uuid,
	"assignment_id" uuid,
	"shift_event_id" uuid,
	"absence_id" uuid,
	"duty_id" uuid,
	"camp_id" uuid,
	"wrote_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close" "wb_projection_close",
	"wrote" jsonb,
	"back_confirmed_at" timestamp with time zone,
	"back_confirmed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_record_id_wb_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."wb_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_assignment_id_wb_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."wb_assignment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_shift_event_id_wb_shift_event_id_fk" FOREIGN KEY ("shift_event_id") REFERENCES "public"."wb_shift_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_absence_id_absence_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."absence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_duty_id_duty_id_fk" FOREIGN KEY ("duty_id") REFERENCES "public"."duty"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_projection" ADD CONSTRAINT "wb_projection_back_confirmed_by_wb_member_id_fk" FOREIGN KEY ("back_confirmed_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_projection_record_idx" ON "wb_projection" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "wb_projection_assignment_idx" ON "wb_projection" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "wb_projection_shift_event_idx" ON "wb_projection" USING btree ("shift_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_projection_absence_uq" ON "wb_projection" USING btree ("absence_id") WHERE "wb_projection"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wb_projection_duty_uq" ON "wb_projection" USING btree ("duty_id") WHERE "wb_projection"."closed_at" is null;
CREATE TABLE "wb_shift_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL,
	"on" boolean NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"until_at" timestamp with time zone NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid
);
--> statement-breakpoint
ALTER TABLE "wb_shift_override" ADD CONSTRAINT "wb_shift_override_camp_id_camp_id_fk" FOREIGN KEY ("camp_id") REFERENCES "public"."camp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_override" ADD CONSTRAINT "wb_shift_override_by_wb_member_id_fk" FOREIGN KEY ("by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_shift_override" ADD CONSTRAINT "wb_shift_override_cleared_by_wb_member_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_shift_override_camp_idx" ON "wb_shift_override" USING btree ("camp_id","until_at");
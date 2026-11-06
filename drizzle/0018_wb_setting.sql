CREATE TABLE "wb_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"on" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "wb_setting" ADD CONSTRAINT "wb_setting_updated_by_wb_member_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;
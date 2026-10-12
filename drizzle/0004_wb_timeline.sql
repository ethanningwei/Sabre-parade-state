CREATE TYPE "public"."wb_created_via" AS ENUM('SELF', 'PROXY', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."wb_record_kind" AS ENUM('RSI', 'RSO', 'MC', 'HL', 'STATUS', 'MA', 'AL', 'OL', 'OFF', 'EVENT');--> statement-breakpoint
CREATE TYPE "public"."wb_record_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'RECORDED', 'CANCELLED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "wb_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" bigint,
	"message_id" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"flow" text NOT NULL,
	"step" text DEFAULT '' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ctx" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wb_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"member_id" uuid,
	"kind" "wb_record_kind" NOT NULL,
	"parent_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"absent" boolean NOT NULL,
	"state" "wb_record_state" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"leave_days" integer,
	"detail" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"ma_timing" text,
	"created_by" uuid,
	"created_via" "wb_created_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wb_record_range" CHECK ("wb_record"."end_at" is null or "wb_record"."end_at" > "wb_record"."start_at")
);
--> statement-breakpoint
ALTER TABLE "wb_card" ADD CONSTRAINT "wb_card_record_id_wb_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."wb_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_record" ADD CONSTRAINT "wb_record_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_record" ADD CONSTRAINT "wb_record_member_id_wb_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_record" ADD CONSTRAINT "wb_record_parent_id_wb_record_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wb_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_record" ADD CONSTRAINT "wb_record_decided_by_wb_member_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_record" ADD CONSTRAINT "wb_record_created_by_wb_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."wb_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wb_card_record_idx" ON "wb_card" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wb_conversation_user_chat_uq" ON "wb_conversation" USING btree ("telegram_user_id","chat_id");--> statement-breakpoint
CREATE INDEX "wb_record_person_range_idx" ON "wb_record" USING btree ("person_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "wb_record_state_idx" ON "wb_record" USING btree ("state");
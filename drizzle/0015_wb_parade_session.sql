CREATE TABLE "wb_parade_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wb_parade_session" ADD CONSTRAINT "wb_parade_session_token_hash_app_session_token_hash_fk" FOREIGN KEY ("token_hash") REFERENCES "public"."app_session"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wb_parade_session" ADD CONSTRAINT "wb_parade_session_member_id_wb_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wb_member"("id") ON DELETE cascade ON UPDATE no action;
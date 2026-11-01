CREATE TABLE "training_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_id" text NOT NULL,
	"held_on" date NOT NULL,
	"expires_on" date,
	"provider" text,
	"scope" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "training_sessions_cancel_check" CHECK (("training_sessions"."cancelled_at" is null and "training_sessions"."cancelled_by_id" is null and "training_sessions"."cancel_reason" is null) or ("training_sessions"."cancelled_at" is not null and "training_sessions"."cancel_reason" is not null and btrim("training_sessions"."cancel_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_recorded_by_id_people_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE no action ON UPDATE no action;
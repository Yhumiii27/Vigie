CREATE TABLE "dgi_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"number" integer NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"workstations" text NOT NULL,
	"danger" text NOT NULL,
	"exposed_workers" text NOT NULL,
	"representative_name" text NOT NULL,
	"event_id" text,
	"signed_at" timestamp with time zone,
	"signed_by_id" text,
	"measures" text,
	"measures_at" timestamp with time zone,
	"measures_by_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "dgi_notices_measures_check" CHECK (("dgi_notices"."measures" is null) = ("dgi_notices"."measures_at" is null)),
	CONSTRAINT "dgi_notices_signed_check" CHECK (("dgi_notices"."signed_at" is null) = ("dgi_notices"."signed_by_id" is null)),
	CONSTRAINT "dgi_notices_closed_check" CHECK ("dgi_notices"."closed_at" is null or "dgi_notices"."measures_at" is not null),
	CONSTRAINT "dgi_notices_cancel_check" CHECK (("dgi_notices"."cancelled_at" is null and "dgi_notices"."cancelled_by_id" is null and "dgi_notices"."cancel_reason" is null) or ("dgi_notices"."cancelled_at" is not null and "dgi_notices"."cancel_reason" is not null and btrim("dgi_notices"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "prevention_plan_workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"person_id" text NOT NULL,
	"added_by_id" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "prevention_plan_workers_cancel_check" CHECK (("prevention_plan_workers"."cancelled_at" is null and "prevention_plan_workers"."cancelled_by_id" is null and "prevention_plan_workers"."cancel_reason" is null) or ("prevention_plan_workers"."cancelled_at" is not null and "prevention_plan_workers"."cancel_reason" is not null and btrim("prevention_plan_workers"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "prevention_worker_vetoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"reason" text NOT NULL,
	"vetoed_by_id" text,
	"vetoed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by_id" text,
	"lift_reason" text,
	CONSTRAINT "prevention_worker_vetoes_reason_check" CHECK (btrim("prevention_worker_vetoes"."reason") <> ''),
	CONSTRAINT "prevention_worker_vetoes_lift_check" CHECK (("prevention_worker_vetoes"."lifted_at" is null and "prevention_worker_vetoes"."lifted_by_id" is null and "prevention_worker_vetoes"."lift_reason" is null) or ("prevention_worker_vetoes"."lifted_at" is not null and "prevention_worker_vetoes"."lift_reason" is not null and btrim("prevention_worker_vetoes"."lift_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "safety_talk_participants" (
	"talk_id" text NOT NULL,
	"person_id" text NOT NULL,
	"notified_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	CONSTRAINT "safety_talk_participants_talk_id_person_id_pk" PRIMARY KEY("talk_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "safety_talks" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"held_on" date NOT NULL,
	"theme" text NOT NULL,
	"animator_id" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sheet_sent_at" timestamp with time zone,
	"sheet_sent_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "safety_talks_duration_check" CHECK ("safety_talks"."duration_minutes" between 1 and 480),
	CONSTRAINT "safety_talks_cancel_check" CHECK (("safety_talks"."cancelled_at" is null and "safety_talks"."cancelled_by_id" is null and "safety_talks"."cancel_reason" is null) or ("safety_talks"."cancelled_at" is not null and "safety_talks"."cancel_reason" is not null and btrim("safety_talks"."cancel_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "safety_induction" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_signed_by_id_people_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_measures_by_id_people_id_fk" FOREIGN KEY ("measures_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_closed_by_id_people_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgi_notices" ADD CONSTRAINT "dgi_notices_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_workers" ADD CONSTRAINT "prevention_plan_workers_plan_id_prevention_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_workers" ADD CONSTRAINT "prevention_plan_workers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_workers" ADD CONSTRAINT "prevention_plan_workers_added_by_id_people_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_workers" ADD CONSTRAINT "prevention_plan_workers_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_vetoes" ADD CONSTRAINT "prevention_worker_vetoes_worker_id_prevention_plan_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."prevention_plan_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_vetoes" ADD CONSTRAINT "prevention_worker_vetoes_vetoed_by_id_people_id_fk" FOREIGN KEY ("vetoed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_vetoes" ADD CONSTRAINT "prevention_worker_vetoes_lifted_by_id_people_id_fk" FOREIGN KEY ("lifted_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talk_participants" ADD CONSTRAINT "safety_talk_participants_talk_id_safety_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."safety_talks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talk_participants" ADD CONSTRAINT "safety_talk_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talks" ADD CONSTRAINT "safety_talks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "safety_talks" ADD CONSTRAINT "safety_talks_animator_id_people_id_fk" FOREIGN KEY ("animator_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talks" ADD CONSTRAINT "safety_talks_sheet_sent_by_id_people_id_fk" FOREIGN KEY ("sheet_sent_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talks" ADD CONSTRAINT "safety_talks_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_talks" ADD CONSTRAINT "safety_talks_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dgi_notices_site_number_unique" ON "dgi_notices" USING btree ("site_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_plan_workers_active_unique" ON "prevention_plan_workers" USING btree ("plan_id","person_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_worker_vetoes_active_unique" ON "prevention_worker_vetoes" USING btree ("worker_id") WHERE lifted_at is null;--> statement-breakpoint
CREATE INDEX "safety_talks_site_idx" ON "safety_talks" USING btree ("site_id","held_on");
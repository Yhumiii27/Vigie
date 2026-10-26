CREATE TABLE "review_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"text" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by_id" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_corrections_text_check" CHECK (btrim("review_corrections"."text") <> '' and btrim("review_corrections"."reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "review_corrections" ADD CONSTRAINT "review_corrections_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_corrections" ADD CONSTRAINT "review_corrections_signed_by_id_people_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_corrections_review_idx" ON "review_corrections" USING btree ("review_id");--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD CONSTRAINT "requirement_evaluations_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD CONSTRAINT "requirement_evaluations_cancel_check" CHECK (("requirement_evaluations"."cancelled_at" is null and "requirement_evaluations"."cancelled_by_id" is null and "requirement_evaluations"."cancel_reason" is null) or ("requirement_evaluations"."cancelled_at" is not null and "requirement_evaluations"."cancel_reason" is not null and btrim("requirement_evaluations"."cancel_reason") <> ''));--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_cancel_check" CHECK (("review_decisions"."cancelled_at" is null and "review_decisions"."cancelled_by_id" is null and "review_decisions"."cancel_reason" is null) or ("review_decisions"."cancelled_at" is not null and "review_decisions"."cancel_reason" is not null and btrim("review_decisions"."cancel_reason") <> ''));
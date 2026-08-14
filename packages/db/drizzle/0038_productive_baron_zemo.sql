CREATE TABLE "scheduling_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"token" text NOT NULL,
	"deadline" timestamp,
	"chosen_slot_id" uuid,
	"event_id" uuid,
	"closed_at" timestamp,
	CONSTRAINT "scheduling_polls_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "scheduling_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ADD CONSTRAINT "scheduling_polls_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_polls" ADD CONSTRAINT "scheduling_polls_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_slots" ADD CONSTRAINT "scheduling_slots_poll_id_scheduling_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_votes" ADD CONSTRAINT "scheduling_votes_slot_id_scheduling_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."scheduling_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_votes" ADD CONSTRAINT "scheduling_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One answer per person per slot: voting again changes the answer.
CREATE UNIQUE INDEX "scheduling_votes_one_per_person_idx" ON "scheduling_votes" ("slot_id","user_id");--> statement-breakpoint
-- The public poll page looks itself up by token on every request.
CREATE INDEX "scheduling_polls_token_idx" ON "scheduling_polls" USING btree ("token");--> statement-breakpoint
CREATE INDEX "scheduling_slots_poll_idx" ON "scheduling_slots" USING btree ("poll_id","start_at");

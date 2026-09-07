CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"predecessor_id" uuid,
	"calendar_id" uuid NOT NULL,
	"external_calendar_link_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"external_calendar_id" text NOT NULL,
	"external_event_id" text,
	"expected_etag" text,
	"ical_uid" text,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_outbox_mutation_position_unique" UNIQUE("actor_id","mutation_id","position"),
	CONSTRAINT "event_outbox_revision_check" CHECK ("event_outbox"."revision" > 0),
	CONSTRAINT "event_outbox_attempts_check" CHECK ("event_outbox"."attempts" >= 0 and "event_outbox"."position" >= 0),
	CONSTRAINT "event_outbox_action_check" CHECK ("event_outbox"."action" in ('create', 'update', 'delete')),
	CONSTRAINT "event_outbox_status_check" CHECK ("event_outbox"."status" in ('pending', 'attempting', 'completed', 'not-needed', 'conflict', 'not-written', 'unconfirmed'))
);
--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_outbox_event_revision_idx" ON "event_outbox" USING btree ("event_id","revision");--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("created_at","id") WHERE "event_outbox"."status" = 'pending';
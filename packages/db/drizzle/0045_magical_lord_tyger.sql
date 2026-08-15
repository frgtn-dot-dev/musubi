CREATE TABLE "event_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rule" jsonb NOT NULL,
	CONSTRAINT "event_reminders_event_id_user_id_unique" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_members" ADD COLUMN "reminder" jsonb;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_reminder" jsonb DEFAULT '{"minutesBefore":10,"allDay":{"daysBefore":1,"atMinute":1080}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The column default is for NEW accounts. Anyone who had already turned
-- notifications off must not be woken up by an upgrade they did not ask for.
UPDATE "user_settings" SET "default_reminder" = '{"minutesBefore":null,"allDay":null}'::jsonb WHERE "notifications_on_by_default" = false;

CREATE TABLE "external_event_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_calendar_link_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_event_tombstones_external_calendar_link_id_external_event_id_unique" UNIQUE("external_calendar_link_id","external_event_id")
);
--> statement-breakpoint
ALTER TABLE "external_event_tombstones" ADD CONSTRAINT "external_event_tombstones_external_calendar_link_id_external_calendars_id_fk" FOREIGN KEY ("external_calendar_link_id") REFERENCES "public"."external_calendars"("id") ON DELETE cascade ON UPDATE no action;
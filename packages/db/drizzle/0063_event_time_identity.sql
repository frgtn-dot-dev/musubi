ALTER TABLE "events" ADD COLUMN "time_model" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "original_start" jsonb;--> statement-breakpoint
ALTER TABLE "external_events" ADD COLUMN "external_series_id" text;--> statement-breakpoint
ALTER TABLE "external_events" ADD COLUMN "original_start" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_events_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_series_original_start_unique" ON "events" USING btree ("series_id","original_start") WHERE "events"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "external_events_series_idx" ON "external_events" USING btree ("provider","calendar_id","external_series_id") WHERE "external_events"."external_series_id" is not null;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_occurrence_pair_check" CHECK (("events"."series_id" is null) = ("events"."original_start" is null));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_occurrence_not_self_check" CHECK ("events"."series_id" is null or "events"."series_id" <> "events"."id");--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_occurrence_series_check" CHECK ("external_events"."original_start" is null or "external_events"."external_series_id" is not null);
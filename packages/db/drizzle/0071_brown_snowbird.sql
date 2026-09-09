ALTER TABLE "external_calendars" ADD COLUMN "provider_access_role" text;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD COLUMN "provider_access_revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "events" ADD COLUMN "is_all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_canceled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organizer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurrence" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "url" text;
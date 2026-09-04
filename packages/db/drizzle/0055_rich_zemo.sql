CREATE TABLE "external_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"task_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"external_calendar_id" text NOT NULL,
	"external_task_id" text NOT NULL,
	"etag" text,
	"ical_uid" text,
	CONSTRAINT "external_tasks_provider_calendar_external_task_unique" UNIQUE("provider","calendar_id","external_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"creator_id" text NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'needs-action' NOT NULL,
	"start_at" timestamp,
	"due_at" timestamp,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"recurrence" text,
	"related_to" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"url" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "external_calendars" ADD COLUMN "supports_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD COLUMN "supports_tasks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "external_tasks" ADD CONSTRAINT "external_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_tasks" ADD CONSTRAINT "external_tasks_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_calendar_updated_at_idx" ON "tasks" USING btree ("calendar_id","updated_at");
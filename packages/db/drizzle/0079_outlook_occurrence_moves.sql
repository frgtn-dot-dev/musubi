CREATE TABLE "outlook_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"calendar_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"master_id" text NOT NULL,
	"status" text NOT NULL,
	"journal" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outlook_moves" ADD CONSTRAINT "outlook_moves_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlook_moves" ADD CONSTRAINT "outlook_moves_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlook_moves" ADD CONSTRAINT "outlook_moves_link_id_external_calendars_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."external_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outlook_moves_owner_family_idx" ON "outlook_moves" USING btree ("actor_id","link_id","master_id","created_at");--> statement-breakpoint
CREATE INDEX "outlook_moves_running_idx" ON "outlook_moves" USING btree ("updated_at") WHERE "outlook_moves"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "outlook_moves_one_running_idx" ON "outlook_moves" USING btree ("link_id","master_id") WHERE "outlook_moves"."status" = 'running';
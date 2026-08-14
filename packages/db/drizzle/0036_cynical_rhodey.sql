CREATE TABLE "event_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"token" text NOT NULL,
	"mode" text NOT NULL,
	"indexable" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "event_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "event_shares" ADD CONSTRAINT "event_shares_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_shares" ADD CONSTRAINT "event_shares_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One live share per event: publishing twice must extend the same page rather
-- than leave two URLs, only one of which anybody knows how to revoke.
CREATE UNIQUE INDEX "event_shares_one_live_per_event_idx" ON "event_shares" ("event_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
-- The public page looks a share up by token on every request.
CREATE INDEX "event_shares_token_idx" ON "event_shares" USING btree ("token");

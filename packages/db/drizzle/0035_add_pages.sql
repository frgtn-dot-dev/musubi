CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_user_position_idx" ON "pages" USING btree ("user_id","position");--> statement-breakpoint
-- Manual partial unique index (drizzle-kit can't express WHERE yet): at most one
-- active default Page per user. Makes lazy ensureDefaultPage race-safe via ON CONFLICT.
CREATE UNIQUE INDEX "pages_one_default_per_user_idx" ON "pages" ("user_id") WHERE "is_default" AND "deleted_at" IS NULL;
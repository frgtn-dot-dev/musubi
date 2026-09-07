ALTER TABLE "event_outbox" DROP CONSTRAINT "event_outbox_status_check";--> statement-breakpoint
DROP INDEX "event_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "uncertain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "result_ref" jsonb;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "remote_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("next_attempt_at","id") WHERE "event_outbox"."status" in ('pending', 'retry', 'attempting', 'unconfirmed');--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_status_check" CHECK ("event_outbox"."status" in ('pending', 'attempting', 'completed', 'not-needed', 'conflict', 'not-written', 'unconfirmed', 'retry', 'blocked', 'cancelled'));
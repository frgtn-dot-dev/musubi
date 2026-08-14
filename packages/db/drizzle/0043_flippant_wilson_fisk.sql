ALTER TABLE "event_users" ADD COLUMN "status" text DEFAULT 'going' NOT NULL;--> statement-breakpoint
-- Answers from public pages join the attendee list. A member who also answered
-- through the link exists in both: the explicit three-state answer wins over
-- mere presence.
INSERT INTO "event_users" ("event_id", "user_id", "status")
SELECT "event_id", "user_id", "status" FROM "event_rsvps"
ON CONFLICT ("event_id", "user_id") DO UPDATE SET "status" = excluded."status";--> statement-breakpoint
-- A published event collects answers, so its attendee section has to be on —
-- otherwise the detail would hold answers and show none.
UPDATE "events" SET "has_attendees" = true
WHERE "id" IN (SELECT "event_id" FROM "event_shares");--> statement-breakpoint
DROP TABLE "event_rsvps" CASCADE;

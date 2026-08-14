CREATE TABLE "scheduling_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "scheduling_participants_poll_email_unique" UNIQUE("poll_id","email")
);
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ALTER COLUMN "owner_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_votes" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ADD COLUMN "owner_email" text;
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ADD COLUMN "owner_name" text;
--> statement-breakpoint
ALTER TABLE "scheduling_votes" ADD COLUMN "participant_id" uuid;
--> statement-breakpoint
ALTER TABLE "scheduling_participants" ADD CONSTRAINT "scheduling_participants_poll_id_scheduling_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_polls"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduling_participants" ADD CONSTRAINT "scheduling_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "scheduling_polls" AS poll
SET "owner_email" = lower(owner."email"), "owner_name" = owner."name"
FROM "user" AS owner
WHERE owner."id" = poll."owner_id";
--> statement-breakpoint
INSERT INTO "scheduling_participants" ("poll_id", "user_id", "email", "name")
SELECT DISTINCT slot."poll_id", voter."id", lower(voter."email"), voter."name"
FROM "scheduling_votes" AS vote
JOIN "scheduling_slots" AS slot ON slot."id" = vote."slot_id"
JOIN "user" AS voter ON voter."id" = vote."user_id";
--> statement-breakpoint
UPDATE "scheduling_votes" AS vote
SET "participant_id" = participant."id"
FROM "scheduling_slots" AS slot, "scheduling_participants" AS participant
WHERE slot."id" = vote."slot_id"
  AND participant."poll_id" = slot."poll_id"
  AND participant."user_id" = vote."user_id";
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ALTER COLUMN "owner_email" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_polls" ALTER COLUMN "owner_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_votes" ALTER COLUMN "participant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_votes" ADD CONSTRAINT "scheduling_votes_participant_id_scheduling_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."scheduling_participants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduling_votes" ADD CONSTRAINT "scheduling_votes_slot_participant_unique" UNIQUE("slot_id","participant_id");

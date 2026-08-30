-- Existing accounts predate announcements, so their empty marker would trigger
-- first-view backfill and silently skip this release. Start them immediately
-- before it; accounts created after this migration still skip old news.
UPDATE "user_settings"
SET "last_seen_announcement" = '2026-08-29'
WHERE "last_seen_announcement" = '';
--> statement-breakpoint
WITH "candidates" AS (
	SELECT
		"suffix",
		CASE
			WHEN "suffix" = 1 THEN '2026-08-30'
			ELSE '2026-08-30-' || "suffix"
		END AS "id"
	FROM generate_series(
		1,
		2 + (
			SELECT count(*)::integer
			FROM "announcements"
			WHERE "id" LIKE '2026-08-30%'
		)
	) AS "series"("suffix")
),
"candidate" AS (
	SELECT "id"
	FROM "candidates"
	WHERE NOT EXISTS (
		SELECT 1 FROM "announcements" WHERE "announcements"."id" = "candidates"."id"
	)
	ORDER BY "suffix"
	LIMIT 1
)
INSERT INTO "announcements" ("id", "title", "body", "min_version")
SELECT
	"id",
	'Musubi 0.1.7',
	'Plan together with complete scheduling polls: vote on availability, see results, add organizer notes, and create timed polls. Public event pages now make RSVPs, guest lists, and event covers clearer.

This update also improves settings and dialogs, restores reliable web push reminders, keeps event notes usable across clients, and respects Outlook calendar permissions.',
	'0.1.7'
FROM "candidate";
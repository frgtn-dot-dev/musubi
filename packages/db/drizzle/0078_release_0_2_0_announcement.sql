-- Share the announcement ID namespace with admin-written messages without
-- overwriting them. Existing read markers and new-account baselines stay intact.
WITH "candidates" AS (
	SELECT
		"suffix",
		CASE
			WHEN "suffix" = 1 THEN '2026-09-20'
			ELSE '2026-09-20-' || "suffix"
		END AS "id"
	FROM generate_series(
		1,
		2 + (
			SELECT count(*)::integer
			FROM "announcements"
			WHERE "id" LIKE '2026-09-20%'
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
	'Musubi 0.2.0',
	'Keep tasks beside your plans, with due dates, priorities and progress. Connect Google Tasks, Microsoft To Do or supported CalDAV task lists, and use list or Kanban views on the web.

The redesigned web calendar brings event and task editing into side panels, new date and time pickers, and page filters for events, tasks and meetings.

This release also improves time-zone handling and meeting details. Meeting replies and organizer actions are available where supported by your provider and enabled on your server.',
	'0.2.0'
FROM "candidate";

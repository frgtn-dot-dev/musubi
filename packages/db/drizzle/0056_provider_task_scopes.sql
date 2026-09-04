UPDATE "account"
SET
	"access_token" = NULL,
	"sync_status" = 'reconnect_required',
	"sync_error_code" = 'insufficient_scope',
	"sync_error_subtype" = NULL
WHERE
	"refresh_token" IS NOT NULL
	AND (
		(
			"provider_id" = 'google'
			AND strpos(COALESCE("scope", ''), 'https://www.googleapis.com/auth/calendar.events') > 0
			AND strpos(COALESCE("scope", ''), 'https://www.googleapis.com/auth/tasks') = 0
		)
		OR (
			"provider_id" = 'microsoft'
			AND strpos(COALESCE("scope", ''), 'Calendars.ReadWrite') > 0
			AND strpos(COALESCE("scope", ''), 'Tasks.ReadWrite') = 0
		)
	);

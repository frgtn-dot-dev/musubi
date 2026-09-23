# Move selected Outlook occurrences

The web event detail offers **Move selected occurrences** for verified finite,
timed UTC families in the connected owner's default Outlook calendar. The user
selects up to 20 unchanged, synchronized occurrences, chooses an earlier/later
shift of 1–720 minutes and reviews each old/new time before starting. Every
occurrence must remain on its original occupied UTC dates. Individually edited
exceptions, cancelled dates and the master recurrence/time stay unchanged.

This is a separate action from changing a recurring series. Each moved ordinary
occurrence becomes an exception. The reason for that distinction is documented
in [the exception investigation](../audits/outlook-series-exceptions-20260923.md).
Whole-series time edits still refuse families containing exceptions/cancellations.

## Execution and recovery

Migration `0079_outlook_occurrence_moves` adds the private `outlook_moves` journal.
Preview persists the exact request, complete family observation and per-occurrence
identities; it expires after ten minutes if not started. The operation UUID binds
an immutable request. Replaying it cannot change the selection or offset. Start
is idempotent, rechecks local authority/content and permits one running operation
per source family. The existing outbox scheduler admits one child at a time;
closing the browser does not cancel the operation.

Each child reuses the existing `graphOccurrenceContent` admission, conditional
PATCH, durable dispatch marker and read-only recovery. Before admission, the
coordinator verifies a fresh native family against the last acknowledged family.
Only ETags may change without a semantic change: Outlook refreshes sibling tokens
when another selected occurrence is moved. Admission still binds the exact fresh
ETags, identity, local revision and family observation. The worker performs its
normal independent checks before dispatch.

Child admission and its parent's queued status commit in one transaction. Native
acknowledgement, local event update and the parent's new expected family also
commit together. A lease prevents parallel coordinators from admitting two
children. An uncertain native write is never resent. The coordinator stops on
failure/uncertainty, distinguishes completed, failed, unconfirmed and unstarted
items, and never rolls back earlier changes. A later read-only acknowledgement may
resolve an unconfirmed item without restarting skipped items. A new preview is
required for further work. Existing unresolved outbox operations prevent unsafe
re-admission.

This is not an atomic family transaction: Graph protects the selected event's
PATCH, not every sibling against a simultaneous external edit. The complete
before/after observations detect supported concurrent changes and stop the batch.
Meetings can send an update for each selected occurrence and reset its RSVP.
The preview and confirmation button say so; completion does not claim that a
recipient received the email.

## API and access

All routes require authentication and use `Cache-Control: private, no-store`:

- `GET /api/v1/events/:eventId/outlook-move/options` reads eligible dates.
- `POST /api/v1/outlook-moves/preview` validates and stores an exact preview.
- `POST /api/v1/outlook-moves/:operationId/start` starts that saved preview.
- `GET /api/v1/outlook-moves/:operationId` reads its durable result.
- `GET /api/v1/events/:eventId/outlook-move` reopens the family's latest operation;
  a running operation takes priority over unused previews.

Reads recheck source ownership, OAuth account, provider access revision and the
family's non-redacted organizer mappings under the calendar lifecycle fence.
Results expose dates/statuses and the series title, not native IDs or participant
addresses. Disconnect/deletion is handled by the existing source lifecycle and
journal foreign keys. No frontend polling request dispatches a write.

The optional `outlookOccurrenceMove` capability is sent only to clients requesting
`outlookOrganizer=9`; v8 and earlier responses retain their existing shape.
The existing organizer-write and event-time-edit flags must be enabled. This work
does not change their deployment configuration. Mobile native clients do not yet
expose this bulk action; the responsive web dialog does.

## Verification, 2026-09-23

The DB integration suite covers 26 scenarios: personal/meeting and canonical/flat
families, frozen request replay, duplicate start, competing batches/workers,
expired/foreign/invalid selections, local/native conflicts, access changes,
redacted reads, a failure after earlier success, lost responses, restart before
dispatch and read-only recovery after accepted dispatch. Existing occurrence
content/time and series-time regression suites also pass. The suite runs in the
normal sharded DB CI job.

A live end-to-end run used two newly created fixtures in one Outlook account's
default calendar: one personal series and one organizer meeting with the explicitly
authorized test recipient. Both used this coordinator and the real child outbox,
moved two ordinary occurrences by 30 minutes, preserved an independently edited
exception and cancelled date, and left the master time/rule unchanged. Each sent
exactly two occurrence PATCHes. Both fixtures were removed and confirmed absent
(DELETE 204 / cancel 202, then GET 404). An earlier fixture preparation attempt
used HTML rather than the application's text response preference, was rejected
before bulk admission and was also cleaned. Recipient email delivery was not
asserted.

Web tests cover preview-before-write, frozen retries, reload/account boundaries,
progress through event revision refresh, partial/unknown results and no POST on
reopen. Playwright exercises the event detail → selection → exact preview →
confirmation → result → close/reopen flow at 1280px/light and 390px/dark, including
keyboard focus, axe, layering, horizontal overflow and console errors. The existing
series-time editor is included in the browser regression run. Browser plugin not
available; the repository's Playwright workflow was used. Other browsers and native
mobile presentation are not covered by this change.

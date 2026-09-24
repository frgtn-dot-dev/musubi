# Move selected Outlook occurrences

The web and native mobile event details offer **Move selected occurrences** for verified finite,
timed families in their verified series time zone in the connected owner's default Outlook calendar. The user
selects up to 20 unchanged, synchronized occurrences, chooses an earlier/later
shift of 1–720 minutes and reviews each old/new time before starting. Every
occurrence must remain on its original occupied local dates. Individually edited
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
closing the browser or mobile panel does not cancel the operation.

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
`outlookOrganizer=10`; v9 keeps its UTC-only contract, and v8 and earlier responses retain their existing shape. Bulk endpoints also require this opt-in for non-UTC previews, results and starts. See [global time-zone rules](outlook-time-zones.md).
The existing organizer-write and event-time-edit flags must be enabled. This work
does not change their deployment configuration. Native mobile clients expose the same bulk action using the existing sheet, picker and button primitives.

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
mobile presentation were not covered by that web change.


## Native client, 2026-09-24

The native action is offered only for an exact stored home-source event with the
server capability. Its sheet stays mounted across canonical observation revisions;
other provider editors retain their revision-based invalidation. The account,
server, source and occurrence remain outer session boundaries.

A captured authenticated client reads the latest durable operation on open. Only
explicit Preview/Move actions send POSTs. A failed preview retains its immutable
request for an identical retry after a fresh status read. Reads are aborted on
revision changes, backgrounding and disposal; backgrounding clears rendered dates
and pauses polling. Foregrounding revalidates status before actions are enabled.
A revision notification during a write hides the old view and coalesces a fresh
read after the write settles. Neither reopening nor polling restarts work.

The virtualized selection list allows at most 20 dates. Preview rows show old/new
times in the series zone and honor the user's date order and 12/24-hour setting;
an overnight end date is explicit. Meetings require a button that says guests will
be notified. Running/partial results distinguish moved, failed, unconfirmed and
unstarted occurrences; unconfirmed results cannot open a new preview. No provider
family data is added to the offline event store or persisted by this UI.

Verification: native transport, session lifecycle, component wiring and formatting
tests cover immutable retries, double taps, explicit confirmation, expired
previews, account/source boundaries, revision/read races, background/resume,
read-only reopen, partial outcomes and global zones. The full client Vitest suite,
TypeScript and client lint are run for this change.

Rendered QA used the actual React Native components in a temporary Expo Web
harness with simulated API replies, at 390×844/dark, 320×740/dark and
768×1024/light. It exercised detail → selection → preview → event revision refresh
→ explicit start → close/reopen → partial/unknown result, checked viewport bounds
and captured screenshots. Browser plugin not available; Playwright was used.
Only the expected native BackHandler-on-web warning remained. This is presentation
and interaction evidence, not a new live Graph integration test. The available
Android emulator contains a release-only app; native keyboard, TalkBack/VoiceOver,
Android/iOS binary execution and device lifecycle behavior still need device QA.
The earlier live coordinator evidence above remains unchanged.

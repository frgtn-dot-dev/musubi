# Provider meeting and reminder observations

The Google, Microsoft and CalDAV readers retain a separate provider observation
on the source mapping. It contains organizer evidence, participant roles and raw
responses, the connected copy's own response when proven, native reminders, and
raw availability/privacy/event-type values. Unknown enum values remain intact.
This does not create Musubi social participants or schedule Musubi reminders.

Authenticated `GET /api/v1/events/:eventId/provider-state` returns `{ state, version }`.
Only the connected account's live source calendar membership can read a state;
other calendar members and linked copies receive null. Disabled connections,
removed membership and deleted events cannot expose this personal evidence.

Observations are separate from the mapping's write validator. A pending content
write retains incoming state durably; its accepted echo is promoted at ACK even
when the resulting ETag differs. Observation timestamps prevent an older retained
snapshot from replacing a newer accepted observation. Conflicting observations
remain on the delivery record until reconciliation; the endpoint does not claim
that pending state is accepted. Repeated identical observations neither increment
the event revision nor fan out provider writes.

Google uses explicit organizer/attendee `self` evidence. Microsoft retains
`isOrganizer` and the account-copy `responseStatus`, without inferring attendee
identity from calendar ownership. CalDAV needs separate scheduling identity proof
before reporting the user's own response. Partial attendee lists are marked.
CalDAV VALARM fields are summaries, not an editable reconstruction of the alarm;
the original resource remains the preservation boundary for unknown properties.

This is the read/preserve prerequisite for K13/K14. Provider RSVP, organizer
notifications and full free/busy access redaction remain separate implementation
work. Client reads and the default-off Google reminder slice are described below. It does not enable invitation delivery or
claim live two-account acceptance. Version and activation gates are unchanged.

Validation includes parser fixtures for all three providers and authenticated
HTTP through PostgreSQL: same-ETag metadata adoption, personal access boundaries,
no revision/fanout, pending conflict retention, ACK promotion, stale observation
fencing and membership revocation.

Web and native details now fetch the private observation when opened, without
persisting it in shared event caches. Account/connection identity changes reject
late responses. Imported series settings are explicitly labeled as series data;
stored exceptions retain their own ID. Musubi attendance/reminders are named
separately, and the panel explains that independent applications may both notify.
Unavailable metadata is visible as a read failure with reopen-to-retry guidance.
The meeting controls remain read-only. Personal Google reminder editing is separately gated as described below.

## Google free/busy-only boundary

Google's [`freeBusyReader`](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
provides busy intervals, not Events detail access. Musubi currently excludes that
grant from its authoritative set of detail-calendar mirrors. Completed discovery
therefore removes an existing downgraded mirror before fetching any events, even
if a later event request fails. Restoring detail access permits a fresh import;
this is not a user opt-out tombstone. No remote calendar or event is deleted.
Incomplete calendar discovery retains the prior state and must be retried.

This is an explicit unsupported boundary, not a free/busy visualization. A native
busy-interval model using Google's [Freebusy API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
still needs implementation. Other privacy downgrades (e.g. writer to reader for
private events), Graph/CalDAV access evidence, and already exported independent
copies require separate handling; this guard does not claim to revoke content
from other applications or offline caches.

## Default-off Google reminder writes

`PROVIDER_REMINDER_EDITS_ENABLED=false` independently gates the authenticated
`POST /api/v1/events/:eventId/provider-reminders` endpoint, worker and adapter.
No production activation or account write is part of this implementation.
The read endpoint now returns `{ state, version }`; `version` is an opaque CAS
value for the accepted source mapping, ETag and personal observation.

The writer accepts legacy one-offs and explicit zoned/all-day one-offs. Fresh
Google GET and PATCH responses include native temporal normalization; known models
require an exact civil model match as well as matching content/instants before
write, no-op acknowledgement and uncertain recovery. Equal-offset IANA zones are
not interchangeable. Timed Google resources with a separately specified different
end zone cannot be represented by the single-zone local model and are refused.
When time edits are disabled, reminder-enabled pulls carry observation-only
temporal evidence into the pending comparison. That evidence never adopts a
canonical time model or enables the time-edit feature.
Floating, recurring, detached and cancelled definitions stay
refused; series/occurrence evidence requires a separate capability.

An intent supplies an operation UUID, expected event revision, expected state
version, provider `google`, and either `useDefault: true` or `useDefault: false`
with up to five `email`/`popup` overrides (0–40320 minutes). Only an editor of
their own connected source copy can enqueue it. Replay is durable; membership
and destination are rechecked. Pending operations serialize with canonical
content writes even though a personal reminder edit does not increment the
canonical revision. It does not create Musubi reminders or fan out to copies.

Delivery reads fresh provider evidence, requires canonical content to match the
accepted local event. Pending pull uses the same temporal predicate and also
requires the desired native reminder settings before classifying an observation
as an echo. A newer zone or reminder choice observed before ACK remains a durable
conflict rather than disappearing behind a cursor advance. Delivery checks the OAuth write grant and calendar role, and sends
an ETag-conditional Google PATCH containing only `reminders`, with
`sendUpdates=none`. Matching native preferences can confirm a recovered write
only when canonical content also matches. An ambiguous response (including an
incomplete successful response) is reconciled by GET before another PATCH.
Unexpected content or version changes retain a conflict without adopting the
unseen version. Reminder conflicts use the dedicated comparison described below.

Local fake HTTP plus PostgreSQL tests cover the disabled gate, authenticated
queue, source ownership, CAS, concurrent/replayed intent, predecessor ordering,
exact PATCH fields, guest-copy preservation, 503 recovery, incomplete successful
responses, and concurrent remote content changes. These are not live provider
acceptance.
Series evidence, Microsoft/CalDAV writes, and real-account validation remain unfinished; the
flag must remain off until these activation prerequisites are addressed.


## Explicit Google reminder conflict confirmation

The existing authenticated delivery preview has a separate `reminderResolution`
object containing the saved desired settings, fresh native settings and an opaque
state version. It is available only for the latest isolated personal reminder
intent on the caller's live writable source. Canonical content and explicit time
must still match; remote content/time changes, deleted events, series and mixed
pending histories require separate reconciliation.

Confirmation must include `expectedReminderStateVersion` in addition to the
existing revision, operation and ETag comparisons. A client which only knows the
content preview cannot confirm a reminder replacement. The server re-reads the
provider and rechecks the local source, membership, mapping, pending state and
preview in the commit transaction. Even a personal settings change with the same
ETag invalidates the preview. It atomically adopts the inspected baseline and
appends one replacement personal intent; no canonical revision or content patch
is created. Duplicate confirmations reuse that intent. The normal conditional
worker and recovery path then confirm its result.

Fake HTTP and disposable PostgreSQL cover the disabled flag, native preview,
content-only confirmation refusal, stale personal state, local revision races,
simultaneous confirmation, replay, unchanged canonical event and a later reminder
edit after recovery. Legacy, zoned and all-day one-offs use the same flow. Production activation and live account writes are not enabled.


Web and native delivery comparisons display personal Google reminders separately
from canonical event content. They show both the saved target and current native
settings, including defaults, off and unknown provider method values. Confirmation
is labeled “Apply saved reminders” and carries the displayed state version. A
transport failure keeps the same comparison and mutation identity; a conflict
requires a fresh comparison. Cancellation returns focus without writing. These
settings do not schedule Musubi notifications or promise cross-application
deduplication. Client checks cover both renderers; Chromium light 1280/dark 390
covers keyboard, focus, retry, axe, layout and console health. Physical native QA
and live provider reminder acceptance remain outstanding.


## Gated personal Google reminder editor

The private state response optionally advertises `reminderEdit` with the source
revision only when the server reminder flag is on, the caller owns a writable
source membership, and native one-off settings fit the supported write contract.
Unknown methods, missing settings/ETag, floating models, recurring/detached and
cancelled definitions are not offered. This is queue eligibility, not a fresh
provider grant; enqueue and delivery retain their independent checks.

Web and native detail panels offer calendar defaults, off, or up to five custom
email/popup settings with whole minutes 0–40320. A shared draft carries the frozen
revision and opaque observation version; invalid input never submits. Network
retry preserves both draft and operation identity. The typed receipt distinguishes
queued, unconfirmed, conflicted and confirmed delivery. The editor neither changes
canonical event fields nor schedules a Musubi reminder. It uses the event's home
route, including federated origins, and identity changes discard the open editor.

The web editor hands off from the event popover to the existing dialog layer,
returning focus to the calendar event on close; its select popovers remain usable.
Chromium light 1280/dark 390 tests cover native settings, validation, failed-request
retry, exact payload, axe, visible layer hit testing, console health and focus.
Native callback/transport tests cover the same intent and federated source. Live
Google acceptance, physical native QA, series and other providers remain open;
`PROVIDER_REMINDER_EDITS_ENABLED` stays off and versions/minima are unchanged.

Before each editor opening, both clients refresh the private observation. A failed refresh cannot reopen a stale editor; an already-open draft keeps its frozen CAS. The native sheet uses the existing keyboard-avoiding modal pattern, a shrinking scroll area and explicit keyboard dismissal on close. Physical keyboard/device behavior still requires native QA.

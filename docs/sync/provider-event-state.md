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
These controls remain read-only; no RSVP or native reminder mutation is enabled.

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

An intent supplies an operation UUID, expected event revision, expected state
version, provider `google`, and either `useDefault: true` or `useDefault: false`
with up to five `email`/`popup` overrides (0–40320 minutes). Only an editor of
their own connected source copy can enqueue it. Replay is durable; membership
and destination are rechecked. Pending operations serialize with canonical
content writes even though a personal reminder edit does not increment the
canonical revision. It does not create Musubi reminders or fan out to copies.

Delivery reads fresh provider evidence, requires canonical content to match the
accepted local event, checks the OAuth write grant and calendar role, and sends
an ETag-conditional Google PATCH containing only `reminders`, with
`sendUpdates=none`. Matching native preferences can confirm a recovered write
only when canonical content also matches. An ambiguous response (including an
incomplete successful response) is reconciled by GET before another PATCH.
Unexpected content or version changes retain a conflict without adopting the
unseen version. Generic content-conflict resolution refuses reminder intents.

Local fake HTTP plus PostgreSQL tests cover the disabled gate, authenticated
queue, source ownership, CAS, concurrent/replayed intent, predecessor ordering,
exact PATCH fields, guest-copy preservation, 503 recovery, incomplete successful
responses, and concurrent remote content changes. These are not live provider
acceptance. Editing UI, dedicated native-reminder conflict resolution,
Microsoft/CalDAV writes, and real-account validation remain unfinished; the
flag must remain off until these activation prerequisites are addressed.

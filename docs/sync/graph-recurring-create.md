# Graph recurring-create preparation

Recurring creation remains unsupported in the production adapter. These native
candidates are prerequisites for a durable writer and an import contract that
does not duplicate a local master with provider-expanded instances. They are not
a write capability, permission check, or live-provider certification.

## Native identity and recovery read

`graphSeriesCreateBody` prepares a personal, uncancelled, known-time master with
an exactly representable recurrence and the persisted operation UUID as Graph's
`transactionId`. It does not send POST. Organizer/meeting URL inputs, detached
instances, ambiguous time and unsupported rules are refused before network I/O.
The body contains no invitees and retains the event's civil zone.

`findGraphCreatedSeries` freezes the saved event and operation identity, reads
the complete destination-calendar event listing, and requires exactly one match
for that transaction. Pagination is bounded and restricted to the original
HTTPS host and calendar path; loops, redirects, partial responses, malformed
pages and duplicates fail closed. Absence returns null and is **not** proof that
a previous POST was never accepted or permission to issue another POST.

A match triggers a fresh GET of the exact encoded master ID with UTC time and
plain-text body preferences, selected cancellation metadata and expanded
`exceptionOccurrences`. Recovery evidence requires explicit empty cancellation
and exception collections with no continuation, a personal organizer copy with
no attendees or conferencing, the exact transaction/native identity, and the
saved canonical content, known time and recurrence semantics. Changed native
content or rule, exceptions, cancellations and incomplete metadata are refused.
It retains the provider observation and native UID. Graph's ETag is opaque
metadata here; a weak ETag or `changeKey` is not promoted to a conditional-write
or whole-family concurrency guarantee.

Read-only fake HTTP tests exercise complete pagination followed by master GET,
scoped encoded IDs, duplicates, failed later pages, foreign links, loops, partial
responses, redirect/network failures, missing/changed masters, expanded
exceptions, cancellation, independent native zoned/all-day evidence and frozen
inputs. No Graph adapter writer or existing import path is changed.

## Private native create transport

`createGraphSeries` is a private candidate, not composed into the production
Microsoft adapter. The existing default-off time-edit flag blocks all I/O when
disabled. Its caller must prove the own-account OAuth write grant and provide a
pre-write callback which validates the durable attempt/lease; this module does
not create a database journal or perform its ACK.

It freezes the saved event and operation, checks fresh positive `canEdit` on the
exact calendar even for recovery, and performs the complete transaction lookup.
A verified existing master returns without POST. An uncertain missing transaction
remains unconfirmed. Failed permission or initial recovery reads also preserve
the prior uncertainty, including provider conflict/status and Retry-After evidence.
Only a new attempt with no matching transaction may invoke
the pre-write callback and issue one personal POST with the persisted transaction
identity and no attendees. No automatic repeat POST occurs inside this transport.

After a potentially applied POST, complete identity and native master evidence
are read again. Lost/partial/503 responses can recover only through that evidence;
failed verification retains an unconfirmed outcome. An explicit not-written
mutation response stays a refusal. A successful returned ID which differs from
the recovered master is a conflict. Changed content, exceptions, lost read access
or missing evidence cannot be mistaken for proof that no creation happened.

Fake HTTP verifies exact independent zoned/all-day request bodies, the disabled
gate, positive/unknown/revoked grants, callback failure, matching recovery, absent
uncertain recovery, lost/partial/503 responses, redirects, changed native content
and exceptions, returned-ID mismatch and read failure after POST. The callback
is mocked; durable family delivery/ACK and real Outlook acceptance are still
required. This step does not establish Graph event If-Match enforcement.

## Finite original-slot preparation

The private native transport now additionally requires an explicit COUNT with at
most 366 occurrences, with the complete series (including the final endpoint)
inside 730 days from its start. Timed occurrences must have a positive fixed
duration within one civil date. The standalone recurrence/body converters retain
their broader candidate forms; this tighter boundary applies before native create
I/O and prepares a full-family importer, not a calendarView absence heuristic.

`graphSeriesFootprint` returns original occurrence identities and exact known
time values without inventing native event IDs. Zoned COUNT civil slots are
first enumerated as floating values in UTC, so the existing expander cannot hide
a DST gap by replenishing COUNT with a later valid occurrence. Each original
start/end must be unambiguous in the native zone with the accepted duration.
The actual zoned expansion must match these original slots and endpoints. All-day
end bounds account for Graph's exclusive end. Returned values do not mutate the
saved master.

Tests cover all six candidate patterns, exact COUNT/horizon limits, one occurrence,
366 daily occurrences, year-boundary all-day durations, independent expected DST
instants under three host zones, future gap/fold and Lord Howe half-hour changes,
changed duration, cross-midnight and zero-duration timed refusal. The native HTTP
test proves unsupported infinite/UNTIL/oversized series stop before permission
requests, lookup or POST. No missing slot is classified as cancelled by this
helper; a later native family reader must provide complete independent evidence.

## Complete finite family read candidate

`readGraphSeriesFamily` reads the exact mapped master in its calendar, explicitly
expands exceptions and cancellation metadata, and pages `/instances` over the
entire proven COUNT footprint. Pagination cannot leave the HTTPS host, calendar
or master path. Duplicate IDs, partial/malformed responses, loops, redirects,
failed pages and inconsistent counts are refused before returning evidence.

Each active instance must reference that master and exactly one original slot.
Ordinary occurrence times and content must match the proven current master;
exceptions retain their own native content, UID, ETag and provider state. Expanded
exceptions are included even when moved outside the original range. Exceptions
also returned by `/instances` must agree with the expanded observation. Timed
exceptions preserve exact UTC instants with `legacy-unknown` current zone:
historical `originalStartTimeZone` is not evidence of their current zone. Zoned
ordinary instances retain the proven model; all-day values use inclusive dates.

Only a complete finite active set, complete expanded exception set and explicit
unique cancellation cardinality permit classifying missing original slots as
cancelled. Opaque Graph cancellation IDs are retained without parsing dates or
inventing native IDs for absent slots. A second full expanded master read must
produce the same family observation, including cancellation IDs. This detects
observed drift; it does not claim an atomic snapshot, a family CAS, or conditional
write enforcement from an unchanged master ETag.

Independent native fixtures and fake HTTP tests cover DST, all-day year bounds,
a moved exception outside the query window, per-instance native identities and
reminders/privacy, complete cancellation, unknown zone preservation, malformed
and cross-family inputs, incomplete pagination and changed second observations.
This reader is not yet connected to production sync, local recurrence expansion,
the durable create ACK or reset sweep; those integrations must preserve the same
completeness boundary and handle unsupported observations without deleting data.

## Remaining before activation

The durable create operation, permission checks, uncertain POST recovery and
canonical master/instance echo handling must be connected together. Reset and
window movement must not duplicate events or resurrect cancelled occurrences.
The private finite reader now provides full family evidence; durable import and
local expansion must handle its exact exception/cancellation identities before
creation is enabled. Real
Outlook acceptance and conditional UPDATE/DELETE proof remain separate.

Sources: [event identity and transactionId](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0),
[exact master expansion](https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0),
[create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0),
[scoped instances](https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0).

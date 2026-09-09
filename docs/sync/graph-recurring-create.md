# Graph recurring-create preparation

Finite personal recurring creation is composed behind the disabled time-edit
flag: public admission, durable delivery/recovery, full-family ACK and tracked
sync. The sections below describe the individual contracts; client/browser and
live-provider acceptance remain open. Production activation is not implied.

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

`createGraphSeries` is the private native transport used by the specialized
Microsoft recurring-create worker. The existing default-off time-edit flag blocks all I/O when
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
and exceptions, returned-ID mismatch and read failure after POST. These transport tests mock the callback; later sections cover durable family
delivery/ACK composition. Real Outlook acceptance remains required. This step does not establish Graph event If-Match enforcement.

## Finite original-slot preparation

The private native transport now additionally requires an explicit COUNT or UNTIL with at
most 366 occurrences, with the complete series (including the final endpoint)
inside 730 days from its start. Timed occurrences must have a positive fixed
duration within one civil date. The standalone recurrence/body converters retain
their broader candidate forms; this tighter boundary applies before native create
I/O and prepares a full-family importer, not a calendarView absence heuristic.

`graphSeriesFootprint` returns original occurrence identities and exact known
time values without inventing native event IDs. Zoned finite civil slots are
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
test proves unsupported infinite/invalid-UNTIL/oversized series stop before permission
requests, lookup or POST. No missing slot is classified as cancelled by this
helper; a later native family reader must provide complete independent evidence.

UNTIL is accepted only when its complete original-slot set has an exact native
`endDate` round trip. All-day UNTIL uses a valid inclusive date; zoned UNTIL uses
a valid UTC instant. The cutoff is converted in the recurrence zone, subtracting
one civil date when it precedes that date's scheduled start. Raw civil expansion
uses this verified date boundary, avoiding reuse of a UTC cutoff as floating time.
The literal termination cutoff itself must be within the 730-day budget, even
for sparse patterns. Future gaps/folds, fractional native inverse cutoffs and
mismatched slot sets remain refused. The original UNTIL stays unchanged in both
journal event snapshots; native canonical UNTIL may differ in time while proving
the same inclusive endDate. An equivalent COUNT is not an identical retry or
matching native range.

This follows Microsoft's [inclusive recurrence range contract](https://learn.microsoft.com/en-us/graph/api/resources/recurrencerange?view=graph-rest-1.0).
Pure, fake HTTP and synthetic PostgreSQL regressions cover cutoff edges, DST,
complete family evidence, immutable retries, uncertain delivery, atomic ACK and
flag-off sync echo. NoEnd and native UPDATE/DELETE remain outside this batch;
no live Outlook acceptance or conditional-write guarantee is claimed.

## Complete finite family read candidate

`readGraphSeriesFamily` reads the exact mapped master in its calendar, explicitly
expands exceptions and cancellation metadata, and pages `/instances` over the
entire proven finite footprint. Pagination cannot leave the HTTPS host, calendar
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
Tracked known masters now use this reader during sync, including with the edit
flag off. The durable create ACK remains separate; unsupported or missing native
masters currently fail the read without deleting stored data or advancing the cursor.

## Private atomic family persistence

`readGraphFamilyContext` captures the accepted local root, complete child set
(including tombstones), mappings, exclusive origin memberships, grant, native
calendar link and non-secret account eligibility (including refresh-token presence,
never its value). `replaceGraphFamily` rechecks
that context under lifecycle, root/child and source locks before committing a
complete finite observation. Pending local operations, changed local revisions,
foreign native identities, revoked/disconnected sources and unsupported ownership
are refused. Retained cancelled history is released only by a completed exact
replacement receipt on the same source; an unfinished or foreign replacement
still blocks import. This is a private tracked-family query, not discovery or
create ACK.

Each active native occurrence has one canonical child UUID and its own mapping,
UID, ETag and provider state. Original identities are normalized before lookup and storage; equivalent UTC
spellings cannot create a second child. Existing semantic duplicates are refused.
Original identity selects an existing UUID even
when a native ID changes or a retired slot returns. A cancellation preserves an
already observed child's content/time/model and historical mapping. A slot never
observed natively gets only a cancellation definition with its known original
time; no native event ID or per-instance provider state is invented. Removed
original slots become canonical tombstones; a subsequent complete rule revival
can reuse their UUIDs. Returned retained native IDs include cancellation history
for the future reset integration.

The complete candidate has an explicit COUNT or UNTIL of at most 366 and endpoints within
730 days. Full original-slot membership, canonical time consistency and native
ID uniqueness are validated before acceptance; the proposed family is expanded once, rather than
re-expanding the whole family for every child. Root/child changes, mapping
replacement and cancellations commit together or roll back together. Repeated
identical observations do not change revisions or source timestamps. Family
members must belong exclusively to the source mirror; this query does not
silently drop or fan out linked copies. SQL failures expose only a generic error.

Disposable PostgreSQL tests cover stable UUIDs and independent Graph UIDs,
unknown-zone moved exceptions, preserved cancellation content, never-observed
cancellations, native-ID changes, COUNT and UNTIL shrink/revival, year-boundary dates,
no-op, malformed/incomplete rollback, native-ID collision, stale local/mapping
state, pending operation, grant/link/account changes and concurrent one-winner
commit. The engine now suppresses the matching calendarView family and retains its
accepted mapping IDs through reset. Pending-create coordination, authoritative
whole-master removal and durable create ACK remain required before activation.

## Tracked family synchronization

The engine discovers only already mapped known recurring masters, captures their
accepted local contexts, and reads each complete native family before requesting
the bounded calendarView delta. It supplies current/historical native IDs and
master IDs as exclusions. Microsoft filters those records before ordinary
hydration, including stale unmapped instance IDs and removed records. Other
native series retain the existing provider-expanded import contract.

After the complete read and view fetch succeed, each family commits through its
context-checked transaction before ordinary changes. Reset sweep sees the union
of ordinary IDs and all retained family mapping IDs, including cancellation
history. Ordinary per-event upsert/delete checks also exclude a tracked canonical
family under the calendar lifecycle lock. This protects IDs accepted by another
sync after the earlier retained-ID list was captured. An empty/re-windowed view
cannot delete a finite family's master or
suppression definitions. Existing known families keep this read contract when
the time-edit flag is disabled; that flag does not turn accepted definitions back
into independent provider-expanded rows. Each full family read has a bounded
60-second signal, and runs even when the delta reports no family changes.

Actual adapter/fake HTTP/PostgreSQL tests cover both flag states, stale-ID
suppression before hydration, repeated no-op, window renewal/reset, moved and
cancelled exceptions, revival UUIDs, unrelated one-offs, full-reader/view failures
a local revision race before commit, and overlapping sync/reset with replacement
native IDs. Stale per-event updates/deletes cannot bypass full-family evidence. Failed complete proof preserves the
family and cursor.

## Tracked master removal and revival

A missing tracked master requires two complete exact-master 404 JSON error
responses bracketing a complete 200 read of the exact calendar. Failed access,
partial/malformed bodies, a restored master during the check and incomplete
active-family reads fail without applying removal or advancing the cursor.
This is a bounded read observation, not an atomic provider snapshot. The strict
reader used for future create ACK still requires an active complete family;
absence never permits another POST.

After normal view fetch succeeds, the accepted context is rechecked under the
calendar lifecycle lock. Removal tombstones the entire local family atomically,
retaining source maps and original UUIDs. Repeated absence is a no-op. Stale
calendarView components and reset cannot revive it. Tombstoned tracked roots
continue to receive full reads; a fresh complete active proof with the same
master UID restores their original UUIDs and current cancellations. An unrelated
one-off is unaffected. Local revision races refuse removal.

Fake HTTP and PostgreSQL regressions cover negative proof failures, repeated
removal, reset, stale deltas, local races and same-identity revival. Coordination
with a newly appearing or pending create remains required before activation.

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
[scoped instances](https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0),
[calendar read](https://learn.microsoft.com/en-us/graph/api/calendar-get?view=graph-rest-1.0),
[Graph errors](https://learn.microsoft.com/en-us/graph/errors).


## Late family acceptance during ordinary import

Microsoft retains each native instance's parent address as an internal admission
hint even with time editing disabled. Under the calendar shared lifecycle lock,
ordinary upsert checks whether that exact calendar/master address now maps to a
known canonical root, including a retained tombstone. If so, it skips the
component even when the instance has never been mapped and the fetch captured
its exclusions before the family was accepted. Complete family acceptance uses
the exclusive lifecycle lock. The hint never creates canonical parent/original
identity and is not persisted as a substitute for a complete family read.

The adapter/PostgreSQL regression accepts a root during the view response, after
family enumeration, then verifies that none of its four unmapped occurrences
becomes a standalone row. A subsequent full read installs the family normally.
Pending creation without a native master address still requires its own journal
and admission fence before recurring creation can be enabled.


## Private create journal and import admission

A default-off private DB entry point now saves a personal finite known-time root
and one immutable create operation in the same transaction. Exactly one own
writable Microsoft calendar, active OAuth write scope and refresh-token presence
are required. The canonical actor and empty native organizer projection are
stored separately; no attendee or invitation is created. Exact mutation replay
returns the original operation UUID, including normalized UUID/null spelling;
a changed payload cannot reuse it. API Graph serializer/footprint preflight,
public admission, native worker delivery and atomic family ACK remain pending.

Existing outbox claim persists uncertainty before returning its lease. The
private pre-write check validates that exact lease, frozen local event, exclusive
origin membership, current connection/grant and absence of children or mappings.
A generic master-only ACK cannot complete this operation. No HTTP runs inside a
DB transaction.

Until full-family reconciliation resolves the journal, ordinary imports/deletes
on its exact connected calendar are refused under the lifecycle lock. Family
enumeration also stops before native fetch. This includes unresolved cancelled
history and catches admission during an already running fetch, preserving the
cursor. A terminal completed/not-needed operation releases the fence; a removed
historical connection cannot block its replacement. These are prerequisites,
not evidence of successful native create or release acceptance.

PostgreSQL tests cover concurrent exact replay, changed/unsupported admission,
permission rollback, pending/unconfirmed/cancelled import refusal, cursor safety,
lease restart/expiry, local revision/deletion, permission/token removal, premature
mapping/child refusal and generic ACK rejection.


## Private atomic create acknowledgement

Complete personal native master/instance evidence can now atomically install
all mappings and canonical children and complete the exact leased create row.
The same admission/source/lease check runs inside this transaction. The exact
master read also retains native transactionId, which must equal this operation
UUID; matching content alone cannot acknowledge another creation. Saved time,
content and the entire finite original footprint must match; changed exceptions,
cancellations, attendees, foreign ownership, duplicate IDs/UIDs/originals and
unknown instance zones cannot confirm a new personal creation. Equivalent finite
recurrence footprints are compared without depending on RRULE token order.

Native tombstone addresses and existing mappings are checked before installation.
Only the independently validated create row is exempted from the family's pending
operation fence. Existing tracked sync cannot use that exemption. Master map,
children, metadata and journal completion roll back together if any proof fails
or the lease expires before final ACK. Normal full-family sync is a no-op after
acceptance, and stale ordinary instance echoes remain excluded.

PostgreSQL regressions cover timed DST and all-day year boundaries, incomplete or
changed proof, duplicate identities, tombstones/collisions, concurrent one-winner
ACK, deterministic lease expiry during family writes, and subsequent sync no-op.
The worker and public admission described below compose this transaction;
the transaction alone does not prove live provider acceptance.


## Default-off create worker composition

The specialized Microsoft adapter/worker now connects the frozen create journal,
current local and native write permission, stable transaction recovery, one POST,
strict full-family read and atomic ACK. The ordinary legacy create path still
refuses recurring writes. Public known-time create admission is described below.

Transient database failures during authority checks remain retryable before POST;
failures during ACK preserve uncertainty and roll back all family writes. They
are not misclassified as terminal intent conflicts.
A failed/incomplete/changing full-family read stays unconfirmed: retry recovers
the same native transaction and repeats the complete read without another POST.
A definitive initial read failure before mutation can retry creation later;
uncertain absence cannot. The worker preserves uncertainty even when a recovery
attempt sent no new POST. It stores no master-only resultRef on failed family
ACK. Local authority/lease checks run again immediately before mutation, and the
complete transaction validates them at acknowledgement. Worker cancellation and
lease recovery apply to this path as to other durable operations.

Actual adapter, fake HTTP and PostgreSQL tests cover concurrent claims, zoned and
all-day creation, lost POST responses, initial failures, initially invisible
creates, incomplete families, timeout, late lease expiry, flag/native denial and
local/permission/lease races. Every successful recovery has one POST, five stable
canonical definitions/mappings for the four-slot family, and a flag-off ordinary
sync no-op. Uncertain absence never reposts; changed native intent remains a
conflict. No live Outlook acceptance or production activation is implied.


## Default-off public create admission

`POST /events/time` now accepts a personal finite Microsoft series in one owned,
writable connected calendar when explicit time edits are enabled. The strict
request supplies a known zoned or all-day time model. Native projection and the
complete COUNT or UNTIL footprint (at most 366 occurrences within 730 days) are validated
before any local write. Actor identity replaces untrusted creator/organizer data.
Meetings, conference URLs, floating time and unsupported recurrence are refused.

The response is `202` with `localCommitted: true`: only durable local intent has
been accepted. Admission performs no provider I/O; the worker checks fresh native
permission before POST. An explicit UUID `Idempotency-Key`, or the event UUID by
default, identifies exact retries. Changed intent cannot reuse the key or event.

An actor/key's exact saved intent is resolved before new-write permission checks,
including after OAuth write eligibility or calendar access changes. Changed
requests cannot reuse the saved identity. An exact retry reads the current
canonical receipt under event, membership and source locks. A deleted or no-longer-readable event returns a content-free `409`
with `localCommitted: true`; it is never resurrected from the saved request.
Post-commit notification/read failure reports committed state honestly, without
blindly refetching later private edits. Responses use `private, no-store` and
expose neither native projection nor account/journal credentials.

Real HTTP/PostgreSQL regressions cover strict authentication and admission,
concurrent replay, current/deleted results, permission loss between commit and
receipt, notification failure, and unchanged local/other-provider behavior.
Client/browser and live Outlook acceptance remain separate, as do wider recurrence
and native UPDATE/DELETE contracts. Production flags remain disabled.


## Client creation identity

Web quick/full composers retain a creation UUID across failed submissions and
edited retries. Quick-to-full handoff carries it with the existing URL draft;
the full create route assigns it before rendering so reload also preserves it.
A new draft gets a new UUID. The native composer similarly retains identity
through save failures and resets it when the composer is reset or reopened.
A changed request after uncertain acceptance must reconcile under that identity;
changing form fields does not silently allocate a second event.

Client regression tests cover retry, handoff/reset and strict UUID URL parsing.
Browser HTTP mocks cover lost responses followed by reload and HTTP 202 for
finite zoned/all-day series, plus quick/full handoff, in light and dark layouts.
These tests establish client behavior, not live Outlook or physical native
acceptance. Native conditional scope writes and wider recurrence remain separate.

Ordinary legacy and local known-time creation also reconcile existing UUIDs before
new-write admission. A currently readable event matching the requested content
returns HTTP 202; changed content or deletion returns an explicit committed 409,
with current content only when readable. This is current-state reconciliation,
not an immutable historical request ledger. The receipt reader holds lifecycle,
event, membership and source locks, and never appends outbox rows or sends native
requests. Concurrent first submissions converge after the winning insert. Graph
journal retries retain their stricter actor/key/frozen-intent contract.

Actual HTTP/PostgreSQL tests cover both endpoints, legacy/zoned/all-day models,
concurrent first requests, changed/deleted/private results, and an uncertain native
journal whose rows remain unchanged during receipt recovery. Reconciliation is
bounded by retained canonical state; it does not promise UUID recovery after
physical deletion of that state.

## Changed native creation: explicit local adoption

A unique changed personal finite family may now be accepted locally through the
separate [Graph creation adoption contract](graph-create-adoption.md). The
unchanged-create matcher and automatic ACK remain strict. The owner explicitly
chooses the observed provider version; this sends no Graph write, retains the
original intent and releases the pending import fence only after atomic local
family acceptance. Absent, duplicate, meeting, exceptional or unsupported
families remain unresolved.

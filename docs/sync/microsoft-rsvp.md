# Graph one-off RSVP actions

The default-off `PROVIDER_RSVP_EDITS_ENABLED` gate includes the connected account's
own one-off Outlook meeting response. Public admission, private durable intent,
worker, readback, delivery status and existing web/native RSVP controls are wired.
The explicit action is **Send response to organizer**. Notification delivery
always remains unknown. Bounded live Accept/Tentative evidence is linked below;
production activation is not claimed.

## Provider contract and scope

Graph documents calendar-scoped `accept`, `tentativelyAccept` and `decline` POST
actions, `sendResponse`, delegated `Calendars.ReadWrite`, and a `202 Accepted`
response without a body. The request sends only `{ "sendResponse": true }`:
no comment, proposed new time, attendee-array patch or content update.
Sources: [accept](https://learn.microsoft.com/en-us/graph/api/event-accept?view=graph-rest-1.0),
[tentative](https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept?view=graph-rest-1.0),
[decline](https://learn.microsoft.com/en-us/graph/api/event-decline?view=graph-rest-1.0).

These action documents do not establish conditional `If-Match` or action retry
idempotency. The [event transactionId](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
contract applies to event creation. This implementation sends no speculative
conditional header and makes no atomic remote revision or exactly-once claim.
A meeting can change after the last read and before the response action.

Fresh `/me` identity and the exact primary calendar must agree with one matching
non-resource attendee. The calendar must be default, owned by that mailbox and
explicitly editable. Current OAuth/source/role/lease evidence is rechecked before
marking dispatch. Local account, source, membership, mapping and event rows stay
locked through the lease-fenced marker transaction; this does not lock the remote
meeting or authorize a resend. Organizer-self, delegation/secondary calendars, ambiguous or
duplicate attendees, recurrence, draft/cancelled meetings and incomplete native
evidence remain unsupported. Existing Graph event UPDATE/DELETE guards remain.

Transport requests explicit UTC endpoints and plain-text bodies. Exact UTC
instants and inclusive all-day dates are observation evidence; they do not claim
the authored timezone is UTC. Provider timezone fields and all other native data
remain frozen. Pending-pull time evidence is separate from ordinary legacy
canonical reads; RSVP never changes the saved event time model. Canonical text
uses the importer’s trimming rules while the private native baseline remains
byte-for-byte unchanged. An authoritative unchanged one-off import can backfill a
missing mapping UID without revising the canonical event or queuing writes.

## Durable dispatch and recovery

Admission retains the original request, actor/account/source/mapping/revision,
opaque ETag/UID, complete native baseline, self proof and desired state. Before
POST, a lease-fenced private `graph-rsvp-dispatch` marker is persisted. The marker
is never removed, including after an HTTP error or process death. A crash after
marking but before network may leave an unsent action permanently uncertain;
this deliberate tradeoff prevents an automatic duplicate response.

Every later attempt with that marker is read-only. `202` may add private
acceptance metadata but never acknowledges organizer delivery or a current
response. A complete GET establishes the requested response from the native
`responseStatus.response`. The self attendee status may equal either its saved
baseline or the requested response; arbitrary self statuses and every foreign
attendee change remain unsupported. Live one-off Accept QA on 2026-09-10 showed
that Graph can leave the self attendee status at `none` while setting the own
response to `accepted`, and change `showAs` from `tentative` to `busy`. Only that
Accept availability transition, or unchanged availability, is allowed. A subsequent
live Tentative response on 2026-09-10 left the self attendee at
`none`, set the own response to `tentativelyAccepted`, and changed `showAs` from
`busy` to `tentative`. That exact Tentative transition is also allowed; no other
availability transitions or decline side effects are inferred.
ACK stores the actual observed provider state, including the unchanged self
attendee status, rather than synthesizing the desired state. All other native
fields remain frozen except validated response timestamps and opaque server
version/update metadata. Unexpected changes remain unresolved.
An already-matching response is a no-op with no POST. Same-operation admission
replay preserves identity and cannot force a resend.

A missing copy after decline or another action is explicitly **unavailable**,
not proof of success, cancellation or permission to recreate. An unchanged old
response after `202` stays unconfirmed. Delivery distinguishes request saved,
action dispatched, action accepted, response observed and copy unavailable.
After possible dispatch, the action is **Check response**, including a pull
conflict caused by disappearance before ACK. This read-only recovery preserves
the original dispatch marker and conflict snapshot. Generic apply-saved
conflict resolution is not offered for this contract.

A conflict before the durable dispatch marker means the response was not sent.
Delivery reports that Musubi stopped because the current Outlook state could
not be confirmed, instead of promising that the response is queued to send.
This also covers strict native-version drift before POST; the guard remains
unchanged. There is currently no in-app discard/reprepare recovery for these
unsent conflicts. Review the current meeting and respond in Outlook. Refresh
status does not re-admit the saved action, and the original journal remains
available; do not clear the conflict or remove markers to force a retry.

The existing local source/revision/mapping/tombstone checks fence readback ACK.
Projected sync echoes retain pending evidence without independently confirming
raw native preservation; the worker still needs its full read. An older retained
Graph conflict snapshot can be reconciled only after that complete native proof
matches its exact ID, ETag, UID, provider state, content and time. Deleted,
different-version or mismatched snapshots remain conflicts; the permanent
response dispatch marker is preserved. Source revocation
and disabled flags prevent provider work. No migration, new dependency, feature
activation or compatibility-minimum change is required.

## Evidence and remaining work

Fake HTTP tests cover all three exact action bodies, persisted dispatch before
network, same-response no-op, lost replies, accepted-but-unobserved state, decline
absence, unrelated fields, owner/self refusals and time precision/date checks.
Synthetic PostgreSQL tests cover authenticated callers, immutable replay,
marker-before-network restart, no duplicate action, actual adapter echoes,
all-day/DST observations and source/account/role/revision/lease/gate races.
Marker-update interleaving tests use actual PostgreSQL row locks. Disappearance
pull-before-ACK recovery exercises the public endpoint without a second POST;
unchanged whitespace and legacy UID-less imports have separate regressions.
Web/native unit and browser fixtures cover explicit choice, immutable offline
retry, notification wording, keyboard/focus, light/dark and narrow layouts.

Live one-off Accept/Tentative and their read-only recovery passed on 2026-09-10;
the external organizer displayed both responses. Decline removed the Outlook
copy but the organizer still showed the earlier Maybe response, so its delivery
remains unverified. [Exact evidence and retained history](../audits/calendar-outlook-live-acceptance-20260910.md).
Recurring RSVP, delegated calendars, proposed times and broader organizer
operations remain separate work. Ordinary Graph
conditional UPDATE/DELETE proof is still missing and is not supplied by these
response actions or fake servers.

# Google RSVP: evidence contract

K13 has a pure evidence planner and an internal conditional Google transport.
There is no public endpoint, enabled RSVP worker or client RSVP control yet.
Internal two-phase enqueue is described below.
Production and live testing remain disabled/unimplemented.

## Native request

Google documents `attendeesOmitted` as supporting participant-response updates.
The planner emits that marker and exactly one attendee's email/responseStatus;
it never resends the attendee array or copies other event fields into a PATCH.
References: [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [PATCH semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).
The documented more-than-200-guest propagation boundary is unsupported here.
These are protocol assumptions for a future transport test, not live acceptance.

## Identity and preservation

The eventual authenticated adapter must derive `authenticatedCopyEmail` from
its connected provider identity. Client request JSON, Musubi attendance, and
calendar ownership cannot supply that proof. The pure planner requires the
accepted external event ID, strong ETag, one matching self attendee, a different
organizer, full attendees and a normal active one-off with explicit endpoints.
Organizer/resource self entries, private copies, locked/special events and series
are refused. Defaults such as organizer.self=false follow Google's resource
contract; missing organizer identity is not accepted.

The private baseline is cloned. Confirmation permits only the intended self
response and provider ETag/update timestamp to change. All other native data,
including attendee extras, time zones/folds, reminders, conferences, sequence
and unknown fields, must remain equal. A truncated response or unrelated change
cannot confirm the result. This deliberately conservative comparison may reject
provider normalization; it must not be weakened without preservation evidence.
A returned ETag is only a comparison result, not permission to update database
mappings independently of local CAS, source ownership and worker fencing.

## Evidence and remaining work

`apps/api/src/sync/adapters/google_rsvp.test.ts` checks all three responses,
minimal body, case-preserving self identity, frozen baseline, all-day/zoned
endpoints and preservation/refusal cases. The suite is included in API tests.
There is no fake-HTTP or database writer evidence in this slice.

The internal transport below adds primary-account binding and conditional HTTP.
Next are source authorization, durable operation/recovery and conflict semantics,
then clients and live two-account acceptance. Notification delivery is not proven exactly-once
by seeing the desired response in a subsequent GET. Organizer create/update/
cancel, withdrawal and recurring RSVP need their own contracts. No change to
feature flags, versions or compatibility minima is made here.

## Default-off internal HTTP transport

`PROVIDER_RSVP_EDITS_ENABLED` defaults to false. Both adapter entry points refuse
before token or network access when disabled. Production wiring refreshes the
exact user/account token and then verifies its OAuth event-write scope.
A fresh `calendarList/primary` GET must return an owner grant, `primary: true`,
and an email matching the selected external calendar. That provider-derived
identity is compared with the one self attendee; secondary/delegated calendars
are unsupported in this slice. [Primary calendar lookup](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get)
is documented by Google.

The writer rebuilds the minimal patch from its baseline and performs a complete
fresh GET. An already-matching desired response returns without PATCH. Otherwise
the entire accepted baseline must still match before an `If-Match` PATCH with
explicit `sendUpdates=all` and `conferenceDataVersion=1`. The notification policy
is required by the internal caller and does not imply current live authorization.
Redirects and partial reads are rejected; all URLs remain on the fixed Google
origin, with encoded calendar/event IDs.

After successful mutation, another full GET proves preservation. Network loss or
an applied 503 leaves an unconfirmed outcome; a subsequent invocation reads and
recognizes the applied result without a second PATCH. Concurrent native changes
block automatic retry. The returned `notificationDelivery: unknown` never claims
an email was delivered or sent exactly once. An unchanged baseline after an
unapplied 503 permits a conditional retry; stronger notification guarantees still
require live provider evidence and the durable worker contract.

`google_rsvp_delivery.test.ts` exercises real HTTP against a local fake server:
primary identity, disabled/auth-error gates, exact body/query/If-Match,
truncated successful PATCH plus full GET, lost response, applied/unapplied 503,
412 race, same-ETag drift and post-write conference change. The injected token
reader is synthetic; this does not substitute for DB/account authorization,
worker lease/replay, source ownership, or live organizer-visible acceptance.
No external accounts are used by these tests.

## Internal transactional preparation and enqueue

`queueGoogleRsvp` is an internal service, gated by the same disabled RSVP flag.
It first resolves the actor's own live source, editable membership, mapping,
canonical revision and private state version under the established lifecycle /
event / membership / mapping lock order. It returns an exact prior receipt before
provider I/O on replay. Other pending or cancelled source history blocks a new
operation. Floating, recurring, detached and cancelled events remain unsupported.

A fresh OAuth-authorized native read must match both the stored canonical event
(including known civil time) and imported private provider state. The commit then
locks and reconstructs the full local context. Revision, role, link/account,
map identity, ETag, state or calendar-link changes reject the stale preparation.
Concurrent identical requests converge on one operation UUID/receipt. The private
outbox contains the raw baseline and separate baseline/desired provider states;
it does not alter canonical event content/revision, social attendance, accepted
provider observation or local reminders.

This is not yet a usable public RSVP flow: there is no route. The existing worker,
generic ACK, content conflict resolution and generic pull-echo comparison
explicitly refuse the new intent shape. A future specialized worker must replace
those guards with proven identity/CAS, full-resource confirmation, pending-pull
coordination and lease-fenced ACK. A private queue row alone is not delivery.

`provider_rsvp.integration.test.ts` exercises actual token/account lookup,
Google read adapter and PostgreSQL against a fake server: disabled/wrong-user/
wrong-scope/viewer refusal before HTTP; concurrent replay; revision, role,
mapping, native state and time races; legacy/zoned/all-day preservation; and no
generic worker PATCH. It is part of `test:db:events` and `test:db:sync`.
No live invitations, endpoint, migration, rollout or version change is included.

# Google RSVP: evidence contract

This first K13 write-preparation slice is pure logic. It does not expose an
endpoint, authorize an account, enqueue an operation or send a response.
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

Next: authenticated account binding, explicit notification policy, conditional
HTTP transport, durable operation/recovery and conflict semantics, then clients
and live two-account acceptance. Notification delivery is not proven exactly-once
by seeing the desired response in a subsequent GET. Organizer create/update/
cancel, withdrawal and recurring RSVP need their own contracts. No change to
feature flags, versions or compatibility minima is made here.

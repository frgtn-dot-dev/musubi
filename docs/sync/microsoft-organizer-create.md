# Outlook one-off organizer creation

The existing default-off `PROVIDER_ORGANIZER_EDITS_ENABLED` gate now includes
Microsoft **create only**. No deployment activation, OAuth re-consent or live
invitation acceptance has been performed. Update/delete remain refused; this
feature does not establish an Outlook conditional-write contract.

The existing web calendar list and native calendar settings expose **Create
Outlook meeting** after current proof of the connected account's own default
calendar. Admission and dispatch require the matching active OAuth account,
`Calendars.ReadWrite`, local ownership, source identity and access generation.
Native proof reads `/me` and `/me/calendar`: account ID, default-calendar ID,
`canEdit: true` and calendar-owner address must match verified self identity.
Secondary/shared/delegated calendars are outside this contract.

## Explicit invitation contract

The strict Microsoft request branch accepts only `action: create` and
`notificationPolicy: server-invite`. It requires 1–100 unique external guest
addresses, title/content, and explicit UTC or all-day time. All-day input uses
Musubi's inclusive final date and Graph's exclusive end. Required/optional
roles are supported by the API; initial clients compose required guests.

The confirmation says **Create and send invitations**. Graph documents that
creating an event with attendees sends invitations to those attendees. There is
no Google `sendUpdates` option in this branch. Guest addresses stay in the
private provider journal/native observation, never become Musubi calendar
members and do not receive a second Musubi invitation.

## Durable identity and recovery

Admission commits the canonical draft and immutable provider intent together.
The operation UUID is the stable Graph `transactionId`; Graph assigns the native
ID. Before that ID exists, a source-scoped transaction identity fences dispatch.
Full ACK locks and stores the observed native identity. Source access generation,
local revision, membership and account proof are rechecked under the existing
journal lease before dispatch and before ACK.

A permanent possible-dispatch marker commits before POST. Every later attempt
is read-only, including after a lost response, process restart, missing copy or
HTTP failure. A marker written before a crash may leave an actually unsent
meeting uncertain; it never permits an automatic replacement invitation.

Recovery exhausts a bounded calendar-scoped listing (maximum 1,000 pages),
rejecting off-origin/path pagination, duplicate transaction identities and
incomplete evidence. Matching requires the transaction identity, native ID/UID,
self organizer, one-off active non-draft state, complete guest identities/roles,
content and exact time, with no unexpected conference or attachments. An ETag is
retained as opaque observation metadata, not a CAS guarantee. A projected sync
echo cannot ACK the private organizer operation or create a duplicate local event.

Receipts distinguish accepted/observed/uncertain state but always retain
`notificationDelivery: unknown`. Neither HTTP 201 nor native readback proves
mail delivery. Checking a result never sends another POST. Persisted exact source
and native identities retain explicit one-off time readback when time editing or
organizer writes are disabled; unrelated legacy imports keep their existing path.

## Evidence and remaining acceptance

Fake Graph HTTP tests cover exact ownership and native matching, invitation
policy, pagination refusal, lost response and repeated read-only recovery.
Disposable DB tests cover private intent, owner-only Musubi attendance, permanent
restart markers, grant-generation/membership races, immutable replay, pull-before-
ACK and stable native identity. Mounted web and native callback tests cover the
existing creation composition; desktop-light/mobile-dark Playwright tests cover
admission correction, frozen retries, unknown delivery, accessibility and focus
return. These are not physical-device or live guest-delivery acceptance.

Remaining: live OAuth/primary-owner and two-account invitation acceptance,
physical native QA, deployment activation; broader named-zone creation, guest
editing, recurrence and organizer update/cancel are separate implementation or
provider-CAS contracts.

Primary protocol sources:
[Create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)
and [event / transactionId](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).

OAuth account subjects and Graph object IDs are distinct. The selected credential's token verifies `/me` and the editable owned default calendar. The immutable private intent records both identities, the calendar and self address; dispatch and read-only recovery repeat this proof and require the saved binding. A changed Graph identity cannot send or acknowledge the old operation. The shared RSVP transport uses the same binding. Older RSVP journals without that binding retain their receipt and private intent but refuse dispatch/recovery; they never infer an identity or resend. No schema migration is needed.

Guest response metadata may advance to accepted, tentative or declined before readback. Those valid responses do not prevent acknowledgement when transaction identity, exact guests/roles and authored native content still match. This remains evidence of the organizer copy, not invitation delivery.

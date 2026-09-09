# Google organizer actions

`PROVIDER_ORGANIZER_EDITS_ENABLED` is a separate default-off gate. Enabling RSVP
does not enable organizer writes. This implementation supports a connected
account's own primary Google calendar: create a one-off meeting, edit its content
or explicit zoned/all-day time, and cancel it. It also supports content updates
and cancellation of an already imported, bound occurrence. No deployment activation or live
guest-notification acceptance has been performed.

The existing web calendar list and native calendar settings offer **Create Google
meeting** only after a current primary-owner proof. Provider event details offer
**Manage Google meeting** after full native organizer preflight. Every operation
requires `sendUpdates: all`, with **Create and send invitations**, **Save and notify
guests**, or a separate **Cancel meeting and notify guests** confirmation.
External guests stay in the private provider intent/native state; they do not
become Musubi attendees or receive another Musubi invitation email.

## Scope and preservation

Creation accepts 1–100 unique guest email addresses, required or optional in the
API (the initial clients enter required guests), and initializes `needsAction`.
Current clients support the home server only. Attendee-list changes, recurring
meeting creation and whole-series operations, delegation, resource booking, conference creation and attachment writes
remain unsupported. Existing meetings require a complete non-truncated guest
list, strong ETag, UID, organizer-self proof and supported time. Only one local
calendar link is accepted; this path does not fan out changes to other targets.
Timed meetings require positive duration before admission. Persisted organizer journal/source identity
selects one-off inbound time normalization, so later remote reschedules remain
readable even after organizer writes are disabled. Unrelated personal and secondary
calendar imports keep their ordinary editing path; no broad owner-self upgrade occurs.

Updates send a minimal PATCH for explicitly changed title, notes, location or
time. Untouched attendees, responses, conferences, reminders and unknown native
properties remain intact. Changed endpoints preserve unknown endpoint fields.
Readback compares the complete native update result; only valid server version,
update timestamp and sequence metadata may vary. Equivalent timestamp offset
spellings compare by instant, without erasing the named zone. Creation compares
the exact stable identity, private marker, requested content/time and guests;
unrequested conference/attachment creation remains unconfirmed.

Google's [PATCH contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
preserves omitted fields and replaces supplied arrays. The generic content
writer now refuses organizer meetings with external guests, so ordinary Edit or
Delete cannot bypass the explicit notification choice.

## Durable dispatch, ACK and recovery

Admission saves the original operation UUID, stable create ID, body/policy,
actor/account/source/mapping, local revision and full native baseline in the
private outbox. The local draft/update/cancellation and its intent commit in one
transaction. Only stream invalidation is emitted; no Musubi guest email is queued.
Current OAuth/source/membership/event/mapping rows are revalidated and locked
through the dispatch marker transaction. No provider call runs in that transaction.

A permanent possible-dispatch marker precedes every POST, PATCH or DELETE.
Every subsequent attempt is read-only, even if the first process crashed before
sending or Google returned an error. This deliberately permits an unsent action
to remain uncertain in exchange for never automatically repeating invitations.
Create IDs reuse the existing deterministic operation-derived Google identity;
recovery never invents another ID or automatically reinserts after a missing GET.
Google documents [custom create IDs and conditional update/delete](https://developers.google.com/workspace/calendar/api/guides/version-resources).
Updates and cancellations use their original strong `If-Match`. A changed version
is a conflict, never an automatic rebase or force-resend.

A matching unchanged meeting sends no action and records that no new notification
request was made. A full desired native read can acknowledge create/update without
another write. Cancellation ACK requires a persisted successful DELETE response
and an absent current copy. Missing copies after a lost cancellation reply remain
unconfirmed, rather than claiming guest notification. A late active pull after
cancellation is retained as a conflict and cannot resurrect the local meeting.
The ordinary deletion delta records its exact revision/timestamp transition on
the accepted cancellation receipt. Read-only reconciliation recognizes only that
proven tombstone; unrelated local revisions and deletions still fail closed.

Pulls retain observations without acknowledging from projected content. Native
ACK checks the lease, current local/source identity and retained provider version.
**Check result** observes a dispatched conflict using its permanent marker and
original snapshot. Unresolved observations receive exponential backoff (30 seconds
to one hour), leaving later shared-outbox work eligible. Generic conflict overwrite is unavailable. Source revocation
or the disabled gate prevents further provider I/O; this does not revoke a request
already in flight. No exactly-once notification or guest-delivery claim is made.

Google's [insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
and [delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)
contracts describe `sendUpdates`. This bounded UI does not offer `none` or
`externalOnly`; provider acceptance/readback is distinct from recipient delivery.

## Verification and remaining acceptance

Fake HTTP cases exercise the exact action/policy/conditional headers, permanent
marker, lost replies, no resend, complete native preservation and unsupported
identity shapes. Synthetic PostgreSQL cases cover authenticated public admission,
immutable replay, source races, process restart, adapter pull-before-ACK and stale
cancellation pulls. Web/native tests cover explicit choices, field deltas,
cancellation confirmation and frozen offline retries; browser cases cover all
three actions in desktop light and narrow dark layouts. Explicit pre-admission
validation rejection (including invalid resolved DST duration) lets callers correct a guest or time and choose a fresh operation
identity; ambiguous failures keep the exact frozen request. Marker-only receipts
say that the action may have been sent, never that Google was definitely asked.
Regression cases include actual sync cursor advancement after rescheduling, an
ordinary cancellation deletion delta before stale active input, and forty older
uncertain operations yielding to the next queued observation.

All provider traffic in tests is intercepted by a loopback fixture. No live
meetings, invitations or organizer acceptance were sent. Broader guest editing,
whole-series operations, occurrence time editing, federation callers and a human-reviewed two-account live
notification acceptance remain separate work. No schema migration, dependency,
compatibility-minimum or version change is required.

## Existing-instance organizer scope

A stored timed or all-day child can expose **Manage this occurrence** only after
fresh primary-owner and full native guest-state proof. Title, notes and location
are editable; time and guest fields are absent. Cancellation has a separate
**Cancel this occurrence and notify guests** confirmation. Generated slots,
masters, following scopes and new exceptions remain unsupported.

The public request explicitly supplies `scope: occurrence`, its exact child
revision, provider observation version and an opaque `expectedInstanceVersion`.
The latter hashes the validated parent revision/mapping and original slot; it
cannot replace a missing imported binding. The immutable private intent retains
that complete binding. Admission, dispatch and ACK recheck parent-before-child
locks, parent generation/mapping, original identity, active source/account,
membership and attempt lease. Pending or cancelled parent operations refuse the
child action. Native `recurringEventId` and `originalStartTime` must match even
when the instance has moved across a date or DST boundary. Full native readback
preserves guest responses, timing, slot identity and opaque properties.

Only the exact saved cancellation revision (or its recorded accepted inbound
tombstone) may reconstruct the active binding for check-only reconciliation.
The shared RSVP reader still refuses cancelled children. Parent/sibling events
and the child mapping's parent/original identity are never rewritten. Lost
cancellation replies remain uncertain; no retry resends notifications.

`provider_organizer_instance.integration.test.ts` covers both time kinds through
the authenticated public endpoint: stale observations and parent/native identity,
pending parents, commit/dispatch/ACK source and lease races, rejected generated
and master requests, lost replies and accepted cancellation tombstone replay.
The existing one-off organizer and RSVP instance DB suites also pass. Four mocked
browser cases cover update/cancel in desktop light and narrow dark layouts,
exact stored child payloads, accessibility and focus return. Native/shared tests
cover content-only payloads and stale/generated caller refusal. These are local
fake-provider checks, not live guest-delivery acceptance.

Cancelled-instance inbound regression coverage uses the real Google time
normalizer and event upsert. Google returns these exceptions as active-shaped,
`isCanceled` projections; an exact saved parent/original-slot cancellation is
retained as deletion evidence without applying reconstructed master content,
changing the mapping ETag, or altering the permanent dispatch marker. This works
before and after ACK. Stale active copies and foreign slots remain conflicts;
read-only reconciliation still requires native cancellation and the persisted
accepted DELETE response.

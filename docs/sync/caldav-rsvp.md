# Gated personal CalDAV RSVP

The existing default-off `providerRsvpEditsEnabled` gate now includes an isolated
CalDAV branch. The authenticated provider-state endpoint offers the existing
web/native RSVP control only after fresh automatic scheduling and self-identity
proof. The explicit action is **Send response to organizer**; its immutable
request carries `provider=caldav` and `notificationPolicy=server-reply`.
Google's separate `sendUpdates=all` contract is unchanged.

## Supported native resource

One complete, non-cancelled VEVENT with a known zoned or all-day time model,
UID, strong ETag and Schedule-Tag is required. RRULE, RDATE, EXDATE,
RECURRENCE-ID, floating/unknown time, organizer-self, delegation and ambiguous
attendees remain unsupported. The authenticated current principal must equal
the calendar owner. Its calendar-user-address-set must identify exactly one
attendee. The organizer's SCHEDULE-AGENT must be absent or SERVER.

Discovery requires `calendar-auto-schedule`, the principal's discovered outbox
with DAV collection and CalDAV schedule-outbox types, positive
schedule-send-reply privilege, and positive write-content privilege on the
resource. Aggregate privileges are accepted according to RFC 6638. Every
PROPFIND proof uses a successful property status and the exact requested href.
The namespace-preserving parser rejects duplicate properties/attributes,
ambiguous responses, DOCTYPE/entity declarations and forged namespaces.
Discovered URLs stay on the same origin; guarded fetch rejects redirects.

Scheduling identity discovery accepts an explicit empty `404` for the collection's
`current-user-principal` only by querying the same-origin root once. That root
must return a valid authenticated principal exactly matching the collection owner;
denied, unauthenticated, malformed and foreign-origin proof remains refused.
This follows [RFC 5397 section 3](https://www.rfc-editor.org/rfc/rfc5397.html#section-3).
The principal address set may contain non-email URI references under
[RFC 6638 section 2.4.1](https://www.rfc-editor.org/rfc/rfc6638.html#section-2.4.1).
Only validated `mailto` members participate in email identity matching; other
well-formed references are neither fetched nor interpreted as email addresses.
Duplicate identities, malformed email members and ambiguous self matches fail.
The separate iCloud personal-content fallback never applies to scheduling:
resource `write-content` remains required for RSVP and organizer updates;
collection `bind`/`unbind` proves only the corresponding create/delete operation.

## Conditional delivery and recovery

The private journal binds actor/account/source, mapping and revision, URL/UID,
baseline ETag/Schedule-Tag, complete before/after resources, self identity,
requested PARTSTAT and notification policy. The raw baseline is never exposed
by the public provider-state or receipt endpoints. JSON replay reconstructs the
same surgical self-attendee PARTSTAT edit. Other attendees, content, time,
VALARM, unknown properties and VTIMEZONE are preserved. No force-send is used;
an already identical response makes no PUT.

The worker rechecks the gate, current account/source/role, lease and mapping,
then fresh scheduling proof and the complete native resource. PUT uses strong
`If-Match`; it does not use Schedule-Tag merge semantics. Before the first PUT, an atomic journal update permanently records permission
to attempt dispatch, under the live lease and current source/account checks.
New intents carry the versioned `caldav-rsvp-at-most-once` policy. Once its
`startedAt` marker exists, recovery only reads: it never repeats the PUT, even
after a definite HTTP refusal. Legacy intents without that policy also recover
read-only because their dispatch history cannot be established. A crash after
the marker but before network I/O can therefore leave an unsent response
unconfirmed; safety takes precedence over automatically sending it again. Confirmation requires the complete
intended resource, allowing only validated server-owned DTSTAMP and organizer
SCHEDULE-STATUS differences. SEQUENCE and other attendee changes remain exact.
Desired PARTSTAT alone cannot acknowledge an intent. Pull and ACK use the same
raw provider-state projection, preserving canonical event content and revision.
Lease/source/revision races cannot advance the mapping after a provider write.

Unrelated native changes retain an explicit durable conflict. Marked and legacy
intents offer **Check response**, including after a conflict; this preserves the
marker and uncertainty and performs no further PUT. Receipts distinguish a
queued response request, a response needing verification and a fully observed
response. They never infer organizer delivery from a saved attendee copy. This batch does
not provide a CalDAV conflict overwrite confirmation. It does not expand
Google whole-series operations, organizer writes or recurrence support.

A successful local readback proves the attendee copy was saved. The receipt
continues to report notification delivery as unknown: automatic scheduling and
an organizer SCHEDULE-STATUS are not evidence of organizer or email delivery.
Live two-account organizer acceptance remains a separately authorized human-last
step. This batch enables no flags, minima or versions and performs no live calls.

## Evidence

`caldav_rsvp.test.ts` covers fake HTTP scheduling discovery, namespace attacks,
self identity, exact native preservation, strong CAS, disabled/no-op behavior,
server metadata, lost response recovery and unrelated changes.
`caldav_rsvp.integration.test.ts` covers 38 synthetic PostgreSQL/public API
scenarios including replay/concurrency, forged ACK, pending pull, all-day data,
and source/lease/revision races, atomic dispatch grants, marker-preserving retry,
legacy read-only recovery, expired-lease reclamation, crash-before-PUT and HTTP 412 without resend, receipt
phases, lowercase no-op ACK, transient discovery backoff,
and RSVP-only adapter pulls before ACK, including PT24H across Prague DST.
Pending comparison carries native endpoints with the model; ordinary legacy
imports keep their existing display endpoints. Existing Google one-off and instance RSVP suites
remain registered. Web/native editor regressions prove explicit policy, frozen
retry and honest organizer-delivery wording. Fake-API browser acceptance covers
the real caller at desktop/light and narrow/dark sizes, keyboard retry, focus
return and accessibility. These tests send no real replies.

Primary contract: [RFC 6638](https://www.rfc-editor.org/rfc/rfc6638.html),
sections 2, 3.2.2.3, 3.2.5, 3.2.10, 6.2.3, 7.1 and 7.3.

# CalDAV one-off organizer actions

`CALDAV_ORGANIZER_EDITS_ENABLED` is a separate default-off gate. RSVP, generic
calendar writes, and Google organizer activation do not enable it. The local
implementation uses fake HTTP and synthetic database evidence; no live scheduling
server or actual guest delivery has been accepted. Live activation remains a
separate operator decision. Production startup rejects either organizer flag while
the existing 0.1.8 client/peer minimums remain; no version or minimum is changed
by this batch.

The public organizer request discriminates `provider: caldav` and requires
`notificationPolicy: server-invite`. Web and native callers reuse the meeting
editor with **Create and send invitations**, **Save and notify guests**, and a
separate **Cancel meeting and notify guests** confirmation. External guests are
provider attendees, never Musubi calendar members or a second Musubi mail job.
The server is asked to schedule; individual guest delivery remains unknown.

## Supported scope

Creation accepts UTC timed meetings with positive duration, or all-day dates,
with 1–100 distinct external email addresses. The clients explicitly show UTC;
they do not convert a selected local zone silently. Creating a named-zone meeting
needs a separate complete VTIMEZONE creation contract and is not supported here.
Existing one-off meetings with already accepted known native time support only
summary, description and location changes, bounded same-zone/type rescheduling,
and cancellation. Zone/type conversion, guest-list changes, recurrence,
exceptions, resource booking, delegation and conference creation remain unsupported. There must be one personal local calendar link.

Every operation rechecks exact collection owner/current-principal identity,
calendar-auto-schedule advertisement, a discovered scheduling outbox resource,
positive schedule-send-invite privilege and the action's bind, write-content or
unbind permission. Capability observation verifies update and cancellation
separately; both clients expose only those proven actions. Existing resources require a complete single VEVENT, UID,
strong ETag, Schedule-Tag and a native ORGANIZER belonging to that principal.
Participant SCHEDULE-AGENT must be absent or SERVER; delegation and force-send
parameters are refused. Creation requires one unambiguous own address.
The common strict scheduling-property reader preserves namespace and href
identity and refuses ambiguous or failed properties. Guarded requests do not
follow redirects with credentials.

## Native writes and uncertainty

Create has a stable operation-derived UID and resource URL and uses
`If-None-Match: *`. Content updates surgically replace only changed property
spans in the full resource, using the original strong `If-Match`. Cancellation
uses conditional DELETE. Alarms, VTIMEZONE, DURATION, attendee parameters and
responses, conferences and unknown properties remain preserved. No
If-Schedule-Tag-Match merge is used.

The immutable private journal binds actor, account, current source, mapping,
revision, original request/policy, native identity, full before/after resource,
ETag, Schedule-Tag and scheduling proof. Local admission and intent commit
together. Validated local authority rows remain locked through the permanent
possible-dispatch marker, before the network mutation. This is not a remote
transaction or a guarantee of atomic revocation of an in-flight request.

After that marker, every attempt is read-only, including a crash before send,
a server error or a lost response. No automatic resend or forced notification
is available. Exact desired native readback can acknowledge an update/create;
only validated server-owned DTSTAMP, nondecreasing SEQUENCE and attendee
SCHEDULE-STATUS may differ. A real reschedule requires the deterministic attendee
response reset and at least the requested sequence increment; other attendee
responses remain significant. Parameterized SEQUENCE is refused before admission
and matching, so unknown sequence extensions cannot be discarded by ACK. PARTSTAT and all other resource changes remain
significant. An already matching meeting is a no-op. Cancellation confirmation
requires both a persisted successful DELETE response and current absence; a lost
response followed by absence stays uncertain. Checks use backoff so unresolved
actions cannot monopolize the outbox drain.

Pending pulls retain native observations without independently acknowledging
projected content. The existing local lease/revision/source checks guard final
acceptance. Exact persisted organizer identities continue to import native time
when organizer writes are later disabled; unrelated legacy imports do not change
shape. Accepted cancellation tombstones prevent stale active pull resurrection.
The original intent remains intact throughout reconciliation.

## Protocol references and remaining acceptance

[RFC 6638 sections 3.2.1, 3.2.3, 3.2.5 and 3.2.10](https://www.rfc-editor.org/rfc/rfc6638.html)
define automatic organizer scheduling and Schedule-Tag behavior; section 6.2.2
defines schedule-send-invite. [RFC 4791 section 5.3.4](https://www.rfc-editor.org/rfc/rfc4791.html#section-5.3.4)
covers calendar object ETags. Neither a local PARTSTAT nor a successful resource
write establishes delivery to a guest. Graph organizer conditional updates and
deletes remain blocked on their separate live conditional-write proof; this
CalDAV contract does not infer Graph CAS support.

Focused parser/HTTP, public/database and actual client regressions accompany the
implementation. Final executed counts and independent review are recorded with
the batch handoff; live organizer acceptance and the unsupported scopes above
remain open.


## Explicit rescheduling

The existing editor exposes time fields only after a native time proof. Calendar
kind and zone are locked. Timed edits stay in the accepted UTC or named zone;
all-day edits stay all-day. A non-UTC event needs exactly one matching complete
VTIMEZONE definition, with embedded rules agreeing with IANA at the old and new
endpoints. Native transition intervals are checked independently for both old
and new endpoints, so a native fold is refused even when IANA considers that
civil time unique. Multi-value timezone RDATE properties, multiple RRULEs,
EXDATE/EXRULE observance exclusions and RDATE-only definitions omitting DTSTART
are outside this bounded proof. Recurrence expansion must finish within 20,000
transitions per observance and endpoint; incomplete proofs fail closed.
Raw TZOFFSETFROM/TO values are checked before decoding: minute precision (or
explicit zero seconds), no parameters or trailing text, and the decoder's exact
UTC-12 through UTC+14 range are required. Nonzero seconds and offsets the library
would truncate or wrap are refused; original accepted offset bytes stay intact.
Gaps, folds, mixed endpoint zones, subsecond times, missing/conflicting
zone definitions and nonpositive duration are refused before local admission.
No silent UTC conversion or new timezone definition is performed.

A real one-off retime replaces DTSTART/DTEND property spans and preserves their
existing parameters. An unparameterized supported DURATION may become explicit
DTEND after exact endpoint proof; unrelated resource bytes, including VTIMEZONE,
alarms, conferences and guest parameters remain untouched. An unchanged request
returns the original resource before sequence or response changes.

[RFC 6638 section 3.2.8](https://www.rfc-editor.org/rfc/rfc6638.html#section-3.2.8)
requires rescheduling to reset non-organizer attendees to NEEDS-ACTION. The
immutable desired request includes this exact reset, preserves the organizer's
own attendee response, and advances SEQUENCE once. The server can advance it
further and replace a valid UTC DTSTAMP; full readback requires at least the
requested sequence, a changed strong ETag/Schedule-Tag, and exact requested time
and participation state. An immediate later guest reply remains unconfirmed
rather than broadening the matcher to ignore PARTSTAT. Checks never resend.
[RFC 5546 section 2.1.4](https://www.rfc-editor.org/rfc/rfc5546.html#section-2.1.4)
defines the sequence requirement. Neither resource acceptance nor reset responses
prove individual notification delivery. Returning to a former time is a new
explicit scheduling action, not an automatic undo.

The synthetic scenarios cover actual public admission, invalid-gap correction,
UTC/named-zone/all-day changes, DURATION across DST, native echo before ACK,
no-op, lost response and a guest reply arriving before readback. Web/native
regressions retain the selected zone/type and exact frozen retry request.

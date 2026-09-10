# iCloud invitation intake and native scheduling comparison — 2026-09-10

## Scope and result

The owner authorized tests between their Google and iCloud accounts, confirmed
both Apple-linked addresses, enabled iCloud Mail, and manually added the received
ICS invitation to **Pracovní**. The linked-account identity, actual mail delivery,
manual intake and standard Musubi import are verified. **Musubi iCloud RSVP and
organizer writes are not accepted as passed.** No Musubi scheduling PUT, bypass
of its preflight, production flag or minimum-version change was made.

This follow-up extends the earlier
[read-only discovery evidence](calendar-icloud-scheduling-readiness-20260910.md).
The original proof predates adding iCloud Mail: the refreshed principal address
set now includes both confirmed mailto identities. A single-mailto create proof
must not be assumed to remain unambiguous after that account change.

## Incoming invitation

A Google organizer first invited the Apple-linked Gmail address. The meeting
appeared in that address's Google Calendar, with no iCloud inbox notification or
synced iCloud resource. The organizer cancelled that fixture with notification.
This was not an iCloud delivery success.

A second one-off invitation, **Musubi QA iCloud native inbound 0918**, targeted
the owner's new iCloud Mail address for September 18, 19:00–19:30 Europe/Prague.
Its actual email reached iCloud Mail's Junk folder. Only that QA message was
moved into Inbox. The web calendar still had zero notifications and standard
sync initially had no fixture. The owner subsequently added the ICS to Pracovní.
The event then appeared in native Apple Calendar, the linked local mapping and
the Musubi month view. This is **manual invitation intake**, not automatic
calendar-inbox acceptance.

A diagnostic helper initially reported a false zero after intake because it
used `account.id` from the credentials-only `getCaldavAccountById` result. Retaining
the selected account-list ID fixed the helper. This was not a production import
bug or proof of delayed sync; the helper is not committed.

The stored resource contains exactly one VEVENT, the expected Google organizer,
two attendees, exactly one confirmed iCloud attendee with `NEEDS-ACTION`, and a
strong ETag. METHOD is absent on the stored resource. The production RSVP
preflight refuses it and the Musubi event detail does not offer RSVP.

## Exact read-only scheduling metadata

The manually imported resource returned:

| Request / property | Result |
| --- | --- |
| Complete GET | 200, strong ETag; HTTP Schedule-Tag absent |
| Depth 0 PROPFIND | 207, exactly one matching resource response |
| DAV current-user-privilege-set | Empty property status 404 |
| CALDAV schedule-tag | Empty property status 404 |
| DAV getetag | Property status 200, nonempty |
| DAV resourcetype | Empty property status 404 |

There was no conditional RSVP PUT and no reply outbox intent was created.

## Native Apple comparison

A separate single non-recurring meeting, **Musubi QA iCloud native organizer
0910**, was created in Apple Calendar's own web UI in Pracovní, September 10,
19:15–20:15 local time, with the sole external guest being the authorized Google
account. Standard sync imported it. The Google guest's native calendar displayed
that exact meeting as awaiting a response: native Apple invitation delivery is
therefore observed in this bounded direction.

Despite this actual native invitation delivery, its complete GET also lacked
HTTP Schedule-Tag, and the exact resource PROPFIND returned the same property
statuses listed above. Thus the missing metadata is not isolated to the manually
imported ICS and is not evidence that iCloud cannot send invitations. Native
Apple creation is not a test of Musubi's organizer writer.

Google's native Accept action changed its guest calendar to Accepted. Repeated subsequent iCloud resource reads still showed that Google attendee as NEEDS-ACTION;
return delivery is not accepted as proven. The comparison meeting was then
deleted through Apple Calendar’s explicit Delete and Notify action.

The native organizer is an absolute-path reference, not mailto or urn:uuid.
Read-only comparison established exact equality with a non-email member of the
authenticated principal's calendar-user-address-set, with principal equal to
owner. This is a verified identity outside Musubi's current mailto-only writer
model. It must not be silently converted to either of the two email aliases.

## Contract interpretation and next gate

RFC 6638 [section 3.2.10](https://www.rfc-editor.org/rfc/rfc6638.html#section-3.2.10)
and [section 9.3](https://www.rfc-editor.org/rfc/rfc6638.html#section-9.3) specify
Schedule-Tag for scheduling objects. Its absence in both representations leaves
compatibility with that contract unproved; it does not identify whether the
cause is object state or a provider implementation difference.

Musubi's current PUT uses strong If-Match, not If-Schedule-Tag-Match. The former
protects against concurrent resource replacement; the optional scheduling-tag
merge mechanism is a different concurrency model. See
[RFC 9110 section 13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)
and [RFC 6638 section 3.2.10.1](https://www.rfc-editor.org/rfc/rfc6638.html#section-3.2.10.1).
An ETag does not prove response delivery. Schedule-Tag is also part of the current
persisted Musubi evidence and recovery contract; removing its requirement is not
just a reader fallback.

Positive preflight discovery of resource write privilege is Musubi policy;
server authorization remains necessary, and an unavailable privilege property
is not a confirmed write denial. Reading current privileges is itself controlled
by a distinct privilege under
[RFC 3744 sections 3.7 and 5.4](https://www.rfc-editor.org/rfc/rfc3744.html#section-3.7).
The personal-content authorization fallback does not apply to scheduling.

Keep the current scheduling writer refused for these resources. Any separate
provider-specific experiment needs explicit identity binding, full-resource CAS,
immutable intent/recovery, preserved unrelated fields, honest delivery receipts,
and independently verified native organizer response. No such alternate writer
is implemented or enabled by this audit.

## Fixture status

The manually imported inbound fixture remains active for follow-up diagnosis.
The native organizer comparison was deleted with notification; the obsolete
Gmail-targeted fixture was also cancelled. No claim of successful iCloud RSVP
is made. Native cancellation UI completion alone is not a Musubi cancellation
writer acceptance or a claim that every remote guest copy has disappeared.

## Separate compatibility preflight follow-up

The later default-off attendee compatibility implementation preserves strict
CalDAV behavior and explicitly models the paired empty-404 properties and
absent GET Schedule-Tag. Its first live check used only the existing inbound
fixture and read requests, with both development flags scoped to the QA process.

The native ETag still matched the local mapping. The organizer was the expected
Google mailto identity without SENT-BY, but the stored organizer carried
`SCHEDULE-AGENT=CLIENT`. Preflight correctly rejected that resource. No RSVP
intent, scheduling PUT, parameter rewrite or claim of organizer delivery was
made. A manually imported email attachment therefore does not yet provide a
server-scheduled fixture for this mode. Native invitation intake or a separately
specified client scheduling transport must be evaluated before live acceptance.

Read-only inspection of iCloud Calendar Account settings showed **via In-app
Notifications** already selected for both confirmed aliases. No account setting
was changed. A new Google fixture, **Musubi QA iCloud inapp retry 0920**,
September 20, 19:00–19:30 Europe/Prague, was sent to the sole confirmed iCloud
guest to check fresh intake after Mail activation; this is a separate native
Google invitation test, not a Musubi RSVP write.
The inbox still showed zero notifications and a subsequent standard CalDAV sync
found no active matching resource during this bounded check. The new retry
fixture was cancelled through Google Calendar with notification to its sole
test guest; the UI confirmed deletion. The earlier manually imported fixture
remains available. This observation does not prove eventual delivery impossible.

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

## Remaining before activation

The durable create operation, permission checks, uncertain POST recovery and
canonical master/instance echo handling must be connected together. Reset and
window movement must not duplicate events or resurrect cancelled occurrences.
A full family read/import contract must address remote exceptions and opaque
cancellation identities before local recurrence expansion is enabled. Real
Outlook acceptance and conditional UPDATE/DELETE proof remain separate.

Sources: [event identity and transactionId](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0),
[exact master expansion](https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0),
[create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0).

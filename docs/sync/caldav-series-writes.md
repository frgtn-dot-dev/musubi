# CalDAV series: complete resource evidence and conditional delivery

The default-off `EVENT_TIME_EDITS_ENABLED` capability has an internal
`readCaldavSeries` adapter method. It reads the complete calendar object with its
accepted strong ETag and retains the original UTF-8 body, including detached
components, folded lines, alarms, timezone definitions and extension properties.
The body is private server-side evidence; it must not be logged or returned to
clients. This method does not enqueue or perform a scope write.

Preflight checks account ownership, a matching imported event calendar, resource
membership in that collection, DAV write-content privilege, complete GET and the
previously accepted resource ETag. It rejects weak/missing or changed validators,
encoded path traversal/separators and redirects on both PROPFIND and GET,
projected/partial bodies, unexpected UIDs, duplicate component identities,
duplicate scalar properties, meetings and scheduling METHOD resources. The
existing temporal importer still rejects unsupported RANGE/masterless resources
and recurring timed nominal-day durations. Exactly one recurring live master and
the complete local child set must match content, original identity, cancellation
and explicit civil time model. Zoned, floating and all-day representations are
covered. Empty/missing local children do not silently omit provider exceptions.

This evidence differs from a sequence of Google master/child reads: CalDAV stores
the recurrence family in a single calendar object. The internal content writer preserves
untouched bytes and conditionally PUTs that same object using its accepted ETag.
[RFC 4791, section 5.3.4](https://www.rfc-editor.org/rfc/rfc4791#section-5.3.4)
specifies strong calendar-object validators. A local Radicale test confirms that
changing a detached child's title changes the resource ETag and a subsequent
master-title PUT with the old ETag receives 412 without altering that child.
This local result is not iCloud or every-server acceptance.

## Validation and remaining work

Unit tests cover exact original bytes, moved/cancelled children, zoned/floating/
all-day models, incomplete local families, inconsistent identities, stale content,
weak validators, ambiguous scalar properties and meeting/scheduling refusal.
The Radicale integration exercises the actual adapter through PostgreSQL and HTTP:
accepted full read, account and feature-gate refusal, stale resource rejection,
fragment target refusal, missing local child refusal, and the conditional-PUT
concurrency counterexample that Google could not protect. The synthetic collection
is removed after the test. Existing delta/reset/revival/deletion tests still pass.

## Internal content writer

`prepareCaldavSeriesWrite` accepts only master title, description and location.
It validates the complete baseline and patches its original body, preserving
child components, civil times, recurrence, cancellation, alarms and extensions.
The private input records the accepted reference, baseline family, original body,
patch and desired body. Delivery rebuilds that desired body before any GET/PUT;
a forged replacement cannot widen the operation to another field or child.

The default-off `writeCaldavSeries` adapter rechecks account ownership, the active
imported event calendar, collection membership and DAV write privilege. A fresh
complete GET must either match the complete desired resource (recovery/no-op),
or match both the complete baseline and its original strong ETag. Only the latter
permits a PUT with that exact `If-Match`. No GET silently rebases the write.
A successful PUT is followed by another complete GET; its strong ETag and complete
content become evidence only after the whole desired resource matches. A changed
child, alarm or unknown property therefore prevents confirmation even when the
master's projected fields match. No redirects are followed on any scoped request.

Comparison unfolds physical iCalendar lines and ignores property order between
different property names. It compares original values without typed parser
coercion. Parameter spelling/order, repeated-property order and subcomponent order
remain significant conservatively. Server transformations
outside those serialization differences leave the write unconfirmed; this is not
permission to discard or reconstruct unknown data. A 412 is a conflict without a
confirmed write. Lost connections, applied 503 responses and failed post-write
reads stay unconfirmed. Retrying the same private input first reconciles the whole
resource and does not repeat an already applied PUT. These bodies must never be
included in delivery DTOs, conflict previews, receipts, notifications or logs.

Synthetic HTTP tests cover zoned, floating and all-day families with moved and
cancelled children, conditional success, safe baseline retry, applied-503 and lost
response recovery, concurrent child edits, changed alarms/extensions, stale or
weak validators, partial/invalid UTF-8 responses, redirects and tampered intents.
Radicale additionally exercises real adapter authorization, disabled feature gate,
content updates, child/extension/alarm preservation and repeated delivery against
an actual calendar server. The adapter alone does not change local rows or mappings.

## Scoped transaction and durable delivery

The authenticated scope endpoint now accepts personal CalDAV `series/update`
requests for master title, description and location behind the same default-off
flag. It first reads the complete accepted resource outside a DB transaction.
The commit then rechecks master/child revisions and content, complete membership,
sole authoritative calendar links, connection identity, native component mappings
and ETags. A changed context saves neither a local draft nor an operation receipt.
A successful commit saves the master revision, one private resource outbox intent
and the idempotent operation receipt together. Unchanged children keep their own
content and revisions. Same-operation concurrent requests/replays create no second
intent; a no-op produces no outbox row.

Only a complete personal family owned by the connected user is supported. Shared
copies, multiple target mappings, retained local child tombstones, unresolved
family delivery and retained provider deletion observations are refused. Existing
meeting/time/recurrence/following/occurrence refusals remain in force. This bounded
contract does not claim every CalDAV series can already be edited.

The typed worker rechecks the complete committed local context before delivery
and after the provider confirms the complete desired resource. Short transactions
lock calendar lifecycle, resource identity, master, sorted children, mappings and
finally the leased outbox row. All component mapping validators and the completed
receipt advance together. A stale local child, changed mapping/membership, retained
deletion, disconnected destination or expired/replaced lease cannot produce a
partial acknowledgement. Lease expiry at settlement rolls back mapping changes.
Known temporal families cannot fall through the generic single-event ACK.

Complete inbound resource sync still rejects a family with pending local delivery
before updating any component or advancing its cursor. After the family ACK, the
normal pull accepts the echo without duplicating definitions or revising unchanged
children. Both the original and desired raw resource remain private outbox input;
HTTP receipts and conflict endpoints do not expose them. Unexpected provider
preparation errors are replaced with a safe typed error before reaching HTTP
logging; raw parser lines, stacks and causes are not propagated. Generic conflict hydration
and single-event conflict resolution are deliberately unavailable for this typed
intent: they cannot prove anything about the rest of the resource. A conflict
retains the saved local draft and requires the forthcoming full-resource resolution
flow; automatic rebase is not supported.

Authenticated HTTP/PostgreSQL tests cover concurrent replay, no-op, preparation
races, zoned/all-day/floating delivery, applied-503 recovery, concurrent remote child
changes, changed local children/mappings, replaced leases, retained tombstones,
inbound refusal/echo and generic ACK/resolution refusal. Actual local Radicale also
exercises scoped preparation, durable enqueue, worker delivery and all-component
ACK through a real calendar server. No production flag, version or minimum client
is changed. A subsequent authorized [live iCloud probe](../audits/calendar-icloud-series-live-acceptance.md)
confirmed the internal transport behavior for zoned, all-day and floating master
content edits, complete-resource replay/recovery and concurrent child 412. It did
not establish end-to-end acceptance: a follow-up authenticated zoned scope request
was refused with unknown write permission because resource PROPFIND yielded no
`current-user-privilege-set` evidence. No scope commit or worker ACK followed.
Trustworthy iCloud resource authorization, end-to-end acceptance and resource-aware
conflict resolution remain open; the permission guard stays in place.

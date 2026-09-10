# iCloud whole-resource content write acceptance

## Scope and environment

On 2026-09-08, 20:00:58–20:01:14 UTC, an authorized manual probe used the
connected development iCloud account and Musubi implementation at `1634dbc`
(PRs #176–#178). One newly created temporary calendar contained only synthetic
March 2026 series, without attendees or organizer properties. Existing calendars
were not modified. MKCALENDAR returned 201; final calendar DELETE returned 204.
Credentials stayed in process memory after reading the encrypted local account.
No credentials, account addresses, native resource URLs or personal event data
are part of this audit.

The probe enabled the writer only in its own process and called the real
`prepareCaldavSeriesWrite` and `deliverCaldavSeriesResource` helpers over guarded
HTTPS against iCloud. The running development API kept both time and reminder
write flags disabled. It did not exercise the authenticated scope endpoint,
account-authorization wrapper, database enqueue, worker or all-mapping ACK against
iCloud. Those paths have separate HTTP/PostgreSQL and real Radicale coverage in
[the implementation contract](../sync/caldav-series-writes.md).

## Procedure and observations

Each of zoned (`Europe/Prague`), all-day and floating resources contained a daily
master, one moved exception with its own title and duration, one cancelled
exception, an alarm and an unknown `X-MUSUBI-ACCEPTANCE` property. The fixture
crossed the European DST boundary. Its initial PUT used `If-None-Match: *` and
returned 201 for all three models. Baseline evidence came from a complete GET
of the provider's actual stored serialization, not from assuming uploaded bytes
were stored unchanged. Normalization found both exceptions; the alarm and custom
property survived initial storage.

| Assertion | Zoned | All-day | Floating |
| --- | --- | --- | --- |
| Complete family read with strong ETag | Pass | Pass | Pass |
| Master title, description and location update | Pass | Pass | Pass |
| Complete desired resource verified after PUT | Pass | Pass | Pass |
| Child content, time models and cancellation preserved | Pass | Pass | Pass |
| Same intent replay confirms without another PUT | Pass | Pass | Pass |
| Simulated lost-response recovery without another PUT | Pass | Pass | Pass |
| Concurrent child change rejects stale PUT with 412 | Pass | Pass | Pass |

Complete-resource comparison also protects the retained alarm, custom property,
recurrence and untouched component content. It uses the implementation's
conservative physical-line comparison, not just projected master fields.

For recovery, the probe intercepted a successful real PUT response, consumed it
and threw a synthetic transport error before delivery could observe success.
The first attempt remained `unconfirmed`; retry read the complete desired resource
and succeeded with a total of one PUT. This is an injected lost response after a
real accepted write, not evidence of a naturally occurring network outage.

For concurrency, the probe inserted a second real conditional PUT changing only
the detached child's title between the writer's baseline GET and its own PUT.
The writer then sent its original accepted ETag and received 412 with
`provider-conflict` / `not-written`. A subsequent GET retained the concurrent
child title and did not contain the attempted master title. This demonstrates
resource-wide conditional protection for the tested iCloud fixtures.

## Follow-up: authenticated scope acceptance is blocked

A follow-up probe used the same implementation in a separate disposable
PostgreSQL database and another temporary iCloud calendar. Discovery was limited
to that synthetic calendar before the real sync engine fetched events; no personal
calendar contents were imported into the test database. A synthetic user and
member token exercised the real authentication middleware and scope handler.

The zoned resource imported all three definitions successfully. The scope POST
then returned HTTP 403, `reason: unknown`, `capability: event-write`. A direct
resource PROPFIND for `DAV:current-user-privilege-set`, using the same guarded
transport, normalized to a successful 207 response with the exact requested href
but no properties. The resource and imported collection origins also matched.
Thus the adapter had no affirmative write-permission evidence; it refused in
`seriesAuthorization` before scope commit or outbox delivery. The direct transport
helper tested above accepts authorization supplied by its caller and does not
perform this account/privilege gate itself.

The final diagnostic run was 20:09:58–20:10:09 UTC on 2026-09-08. Its temporary
calendar DELETE returned 204, and the synthetic local user was removed. Earlier
harness attempts were also cleaned up. Scope/outbox tests for all-day and floating
were not reached. No privilege guard was weakened and no parent-calendar grant
was assumed to authorize an individual resource.

The remaining iCloud prerequisite is a trustworthy resource-write authorization
strategy for this provider response, followed by successful authenticated
scope/enqueue/worker/all-mapping ACK and echo acceptance. A successful direct PUT
alone does not establish that Musubi's full write contract is supported.

## Acceptance boundary

This accepts the bounded iCloud transport behavior for personal whole-resource
**master content** edits and recovery in these three fixtures. It does not accept
series time/recurrence changes, occurrence/following scopes, scheduling/RSVP,
shared calendars, masterless/RANGE resources, arbitrary provider serialization,
or full iCloud HTTP-to-database delivery. Resource-aware master-content conflict resolution is implemented and covered
by fake HTTP/DB and Radicale tests; its live iCloud acceptance remains blocked
by the same missing resource permission evidence. K12 as a whole and K13/K14 are not complete. Google whole-series
remains unsupported by the explicit preservation decision recorded in
[its separate live audit](calendar-google-series-live-acceptance.md).

No release version, minimum client version, production flag or deployment changed.

## Follow-up: three standard DAV privilege queries

On 2026-09-08, a further synthetic probe created a new temporary iCloud calendar
and one past event resource without attendees or an organizer. It requested
`current-user-privilege-set`, `owner`, `inherited-acl-set` and
`supported-privilege-set` through three independent standard paths:

| Query | HTTP status | Exact synthetic resource result |
| --- | --- | --- |
| Resource PROPFIND, Depth 0 | 207 | Empty 200 propstat; all four requested properties in 404 propstat |
| Parent collection PROPFIND, Depth 1 | 207 | Same result for the exact resource href |
| Calendar-multiget REPORT for the resource | 207 | Same result for the exact resource href |

No response supplied positive resource write privileges. The matched resource
href stayed on the expected origin. This rules out treating a different DAV
query method or the first response parser as a demonstrated fix. Calendar
ownership in the UI and a successful direct PUT do not supply the missing
resource permission evidence required by the current application contract.

The temporary calendar was deleted successfully (204). No existing calendar was
modified, no invitation was sent, and the running application flags stayed off.
The authenticated iCloud scope path remains unsupported pending a trustworthy
permission mechanism or an explicit product decision about a different contract.
This is a remaining decision/acceptance gate, not an invitation to treat unknown
permissions as write access.

## Follow-up: ACL diagnostic and approved alternative (2026-09-10)

After the user reconnected the local iCloud account, credential decryption worked.
One synthetic past event without attendees was created with `If-None-Match: *`
(201). Resource Depth 0 PROPFIND returned one exact href with property status 404
for `DAV:acl`, `DAV:current-user-privilege-set` and `DAV:current-user-principal`.
The raw ACL query therefore did not provide an alternate permission proof on this
fixture. Independent code review found no demonstrated privilege-parser bug.

Cleanup required a Depth 1 PROPFIND to locate the unique QA resource and a complete
GET for a strong ETag; the initial HEAD did not provide a usable cleanup proof and
calendar-query did not return calendar-data. The exact synthetic UID and summary
were verified before `DELETE` with `If-Match`, which returned 204. One synthetic
resource was removed; existing events were not edited.

The user subsequently approved provider-enforced authorization at conditional
write time for a narrow default-off personal master-content capability. This
supersedes the earlier product-decision gate only for that capability; all other
operations retain their existing permission contracts. See the
[implementation contract](../sync/caldav-series-writes.md#icloud-personal-master-content-authorization-2026-09-10).
Live authenticated scope/enqueue/worker/ACK acceptance of this new path is still
pending; the ACL diagnostic itself does not establish it.

## Accepted: authenticated personal master-content path (2026-09-10)

At 14:17–14:18 UTC the approved fallback was enabled only inside an isolated
acceptance process. It used a new temporary iCloud calendar, a synthetic local
user with its own member token and copied encrypted account credential, and no
background discovery or sync. Existing calendar contents and links were untouched.

For each zoned (`Europe/Prague`), all-day and floating daily series, the provider
stored a master, a moved exception and a cancelled exception. Baselines came from
complete native GETs with strong ETags; the exact resource permission query
confirmed the explicit missing-property condition. Each fixture retained an alarm
and custom properties and had no organizer or attendees.

| Assertion | Zoned | All-day | Floating |
| --- | --- | --- | --- |
| Authenticated HTTP master title/description/location scope accepted | Pass | Pass | Pass |
| One scoped outbox operation delivered by the normal worker | Pass | Pass | Pass |
| Complete desired native resource verified after delivery | Pass | Pass | Pass |
| Moved/cancelled exceptions preserved | Pass | Pass | Pass |
| All three local mappings acknowledged with the native ETag | Pass | Pass | Pass |
| Same HTTP operation replayed; completed worker replay leaves native resource/ETag unchanged | Pass | Pass | Pass |
| Series time edit refused with 403/unknown, no outbox entry or native change | Pass | Pass | Pass |

The test compared the entire delivered resource with the saved desired resource,
not merely the projected master fields. This run accepts authenticated
scope/enqueue/worker/ACK and readback for the narrow fallback. Fake-provider tests
separately cover explicit refusal, concurrent-write 412, revoked local membership
and ambiguous delivery; this live run did not inject those failures again.

Cleanup verified each synthetic UID through complete GET, conditionally deleted
the three resources, verified the collection was empty and deleted it (204), then
removed the synthetic local user. The run reported complete cleanup. No
credentials, native resource URLs or personal calendar contents are recorded here.

This supersedes the earlier missing-permission acceptance gate only for personal
whole-series master title, description and location under the new default-off
contract. Shared-calendar behavior, time/recurrence, occurrence/following writes,
alarms and scheduling are not accepted by this evidence. No production flag,
release version or client minimum changed.

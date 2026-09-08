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

## Acceptance boundary

This accepts the bounded iCloud transport behavior for personal whole-resource
**master content** edits and recovery in these three fixtures. It does not accept
series time/recurrence changes, occurrence/following scopes, scheduling/RSVP,
shared calendars, masterless/RANGE resources, arbitrary provider serialization,
or full iCloud HTTP-to-database delivery. Resource-aware conflict resolution
remains open. K12 as a whole and K13/K14 are not complete. Google whole-series
remains unsupported by the explicit preservation decision recorded in
[its separate live audit](calendar-google-series-live-acceptance.md).

No release version, minimum client version, production flag or deployment changed.

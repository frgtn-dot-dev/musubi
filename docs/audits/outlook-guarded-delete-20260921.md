# Outlook guarded personal-event deletion — 2026-09-21

## Decision and limitation

Enable normal deletion of owned, personal, one-off Outlook events after checking
the exact previously accepted version immediately before DELETE. The product
owner explicitly accepted the remaining race: Microsoft Graph ignored stale
`If-Match` on DELETE, so a change made after the final GET can still be deleted.
This is a usability tradeoff, not compare-and-swap or an atomic transaction.

The [original probe](outlook-event-cas-20260921.md) tested the calendar-scoped
route. An [additional route probe](evidence/outlook-delete-route-20260921.json)
confirmed the same behavior on `/me/events/{id}`: stale DELETE returned 204 and
a subsequent GET returned 404. Changing routes does not close the race.

## Guards and recovery

- Before admitting local deletion, verify the OAuth write grant, writable
  calendar owned by the connected identity, exact source/event identity, accepted
  native `@odata.etag`, and a complete personal-event shape.
- Repeat these checks during delivery and immediately before the scoped DELETE.
  Missing version, changed version, unknown shape, meeting participants, online
  meeting, recurrence, cancelled/draft item, and shared/delegated calendar refuse
  the write. Meetings and series must still be managed in Outlook.
- Keep the native `If-Match` header as best effort only. Never use
  `permanentlyDelete`, cancel-and-notify, a cross-calendar route, or an
  unconditional retry. Redirects are refused and requests have deadlines.
- Confirm a 204 or 404 response with a fresh event GET returning 404. A failed
  verification, 408/5xx, unexpected success status or lost response remains
  unconfirmed; it cannot be downgraded into permission to resend.
- The existing durable outbox claim marks uncertainty before calling Graph.
  After timeout, process death or lease recovery, delivery reads the event only.
  Absence completes delivery. Presence keeps it unconfirmed with a remote
  comparison and a later read-only check, even if its version is unchanged.
- The existing comparison/confirmation flow may create a new delete intent at
  the newly accepted version. Only that operation's first attempt can send.
  A retry or crash of the new intent has the same read-only recovery rule.

There is no new schema, setting, wire contract, permanent-delete behavior or
change to Google/CalDAV conditional writes. Production needs a release containing
this code; merging it alone does not update deployed containers.

## Verification

The [live transport smoke test](evidence/outlook-guarded-delete-20260921.json)
used the actual `deleteMicrosoftPersonalEvent` implementation against a new
disposable calendar. Both a timed and an all-day personal event refused a stale
accepted version without DELETE, then deleted at a freshly accepted version
with 204 followed by 404. The calendar was removed and its absence verified.
No existing events were mutation targets. Evidence contains status/request IDs
and booleans, without credentials or mailbox contents.

`microsoft_event_delete.test.ts` covers permission, source, version and event-kind
guards, absence verification, error classification and one transport attempt.
It also models Graph accepting a concurrent edit after the last GET: the test
deliberately records the remaining limitation rather than simulating false CAS.

`microsoft_delete.integration.test.ts` exercises the actual adapter and Postgres
admission/outbox flow: no local change on stale/meeting preflight, fresh delivery,
version changes after admission, lost accepted and retained responses, read-only
retry, expired lease recovery, explicit resolution, and retry/crash of that
resolution. Existing PATCH, generic delivery, resolution, authenticated event
capability and Google/CalDAV write regressions are also checked.

## References

[Delete event](https://learn.microsoft.com/en-us/graph/api/event-delete?view=graph-rest-1.0)
documents normal deletion and warns that organizer meeting deletion sends
cancellations, which is why meetings remain excluded.
[JSON batching](https://learn.microsoft.com/en-us/graph/json-batching) describes
ordering dependencies; it does not provide an atomic read-and-delete contract.

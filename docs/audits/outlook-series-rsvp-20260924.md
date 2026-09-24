# Outlook attendee series RSVP — 2026-09-24

Adds **Entire series** to the existing web/native Outlook response editor when
fresh native evidence proves a complete finite meeting family. It also supports
the first response to an unanswered recurring invitation. Older clients retain
the occurrence-only/one-off contract through explicit query-version negotiation.

## Contract

- A flat imported occurrence/exception anchors the exact connected default
  calendar, mailbox attendee, native master and original slot. No local master
  adoption or canonical recurrence edits.
- Preview hash plus existing event revision/state version protects admission.
  The complete master, all original slots, paginated instances, moved exceptions
  and explicit cancellations are checked again before dispatch and on readback.
- COUNT/UNTIL, at most 366 slots and 730 days, with the existing strict
  global IANA/Windows time proof. All-day support uses UTC-midnight evidence.
  Unknown, partial, unbounded or ambiguous families do not gain series writes.
- One exact master POST with `sendResponse: true`, preceded by the existing
  permanent dispatch marker. Recovery after any possible dispatch only reads.
- The master and ordinary occurrences must show the requested response.
  Existing exceptions retain their own response, availability, content and time.
  Their response timestamp and version metadata can refresh. A separate master
  confirmation prevents an exception anchor from inheriting a false response.
- All family RSVP admissions share a DB transaction lock, including old
  occurrence-only clients. A pending sibling operation blocks a new admission.
  Account, role, source, revision, mapping and lease are rechecked before dispatch.
- Projected sync echoes preserve evidence/lease; only full worker native proof
  can acknowledge. Siblings refresh through ordinary sync without synthetic
  response updates or new outgoing intents.

## Native and actual application evidence

Two disposable, explicitly authorized Google-to-Outlook invitations used four
09:00 America/New_York occurrences on October 30–November 2, spanning the DST
change. One organizer-modified occurrence had distinct content and moved time.
A separately accepted occurrence established another response override. Native
probe findings were then repeated through **actual Musubi admission, outbox,
adapter and ACK**, using isolated local fixture rows.

| Actual application action | Anchor | Outcome | POSTs |
| --- | --- | --- | --- |
| Initial series Tentative | Ordinary occurrence | Completed; unanswered master and inherited slots become tentative | 1 |
| Series Accept | Ordinary occurrence | Completed; existing exception responses preserved | 1 |
| Series Tentative | Modified exception | Completed; anchor keeps its own unanswered response | 1 |
| Series Decline | Ordinary occurrence | Unconfirmed, `graph-rsvp-copy-absent`; master/copies disappear | 1 |

Read-only recovery was explicitly exercised for the unconfirmed Decline and
sent no additional POST. Completed cases did not need recovery. Organizer
notification delivery is **unknown** for every action; HTTP 202 and native
response state are not delivery receipts.

Both disposable series were cancelled at the Google organizer and cancellation
was read back. Outlook copies were absent. Local synthetic users were removed
and verified at zero; no real events were touched. Committed evidence contains
no tokens, addresses, mailbox IDs, subjects or raw resources.

## Verification

- Fake Graph HTTP: all three actions and exact master address/body, immutable
  raw fields, moved-outside-range exception, explicit cancellation, full
  pagination, bad/missing/duplicate members, unsupported ranges, drift,
  already-matching response, lost replies, marker-before-network and no resend.
- Global time cases: Europe/Prague DST, Windows labels, Asia/Tokyo, UTC all-day
  and inclusive endDate. The live New York proof is separate from these fixtures.
- PostgreSQL/public HTTP: unanswered and answered capability negotiation,
  private evidence redaction, invalid scope/hash rejected without intent,
  immutable replay, stale preview, parent/exception changes, concurrent family
  admission, pending occurrence, source/account/role/revision/slot/lease/gate
  changes, sync echo, exception preservation and read-only recovery. Existing
  one-off and occurrence RSVP suites also passed.
- Web/native unit suites (7/8 tests), API/web/native typechecks, web lint and
  route/realtime/shard inventory checks passed.
- Eight Chromium desktop-light/mobile-dark cases cover one-off, occurrence,
  series and initial-series editors, keyboard/focus return, immutable retry,
  axe, overflow and console errors. Four new-scope cases were repeated after
  spacing polish. The Browser plugin was unavailable; repository Playwright
  provided the documented fallback. Screenshots were inspected manually.

## Boundaries

No production flag, release tag or deployment changed. No schema migration or
new dependency. The existing `PROVIDER_RSVP_EDITS_ENABLED` gate remains off by
default. Repeated native reads are not an atomic remote-family snapshot and
Graph response actions do not establish conditional or exactly-once semantics.
Unbounded/unverifiable series, canonical local-series attendee children,
delegation, general all-day representations and proposed times remain excluded.

[Redacted live results](evidence/outlook-series-rsvp-20260924.json) ·
[Contract](../sync/microsoft-rsvp.md) ·
[Graph accept action](https://learn.microsoft.com/en-us/graph/api/event-accept?view=graph-rest-1.0) ·
[Graph instances](https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0)

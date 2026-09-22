# Outlook end-date series clock time — 2026-09-22

## Behavior

The existing Edit series action now also accepts finite, same-day UTC series
ending on a date (Graph `endDate`, local RRULE `UNTIL`). It retains the same
occurrence dates, native recurrence and native/local identities, including the
last occurrence. The owner's personal events and organizer meetings use the
same path. No UI, request shape, capability version or feature flag changes.

This extends the [counted-series implementation](outlook-series-time-20260922.md).
Its restrictions on exceptions, cancellations, other zones, all-day series,
overnight spans, attachments and online meetings still apply. Infinite series,
changes to recurrence or occurrence dates and “this and following” are not added.

## Cutoff and completion

Microsoft's inclusive end date does not contain a clock time and need not itself
be an occurrence date. Musubi's existing RRULE projection adds the master's UTC
clock. Retaining the old instant cutoff after a forward clock shift could remove
the final occurrence from local expansion.

The change validates the saved cutoff against the exact native end date and old
UTC clock, then replaces only that UNTIL clock with the requested start time.
It does not derive the cutoff from the final occurrence. All other local rule
terms are preserved. Malformed or unbound cutoffs, infinite ranges and fractional
start seconds are refused before dispatch. The complete proposed footprint must
still match every original occurrence date and the original cardinality, within
the existing 366-slot/730-day limits.

The single conditional native PATCH continues to send only start/end and any
explicitly requested content. The full native recurrence must remain unchanged.
Readback checks the rebound master recurrence and every occurrence identity,
original slot, time and protected field. Completion atomically commits the
canonical master's time and recurrence with all children and mapping slots.
Provider-expanded imports stay flat. The existing durable dispatch/acceptance
markers, leases, calendar fences and no-resend recovery are unchanged.

## Verification

[Redacted live evidence](evidence/outlook-series-until-20260922.json):

- Four native probes: personal/meeting × daily/weekly. Later and earlier clock
  shifts preserve IDs, dates and native ranges, including a weekly Saturday
  cutoff after the last Friday occurrence. Stale conditional writes return 412.
  Native cleanup succeeds and GET confirms absence.
- Two complete Musubi admission/outbox/Graph/completion round trips, each with
  two edits: flat personal import and canonical organizer meeting. Both preserve
  HTML, guest identities, dates and IDs. The canonical master alone expands to
  all three new slots, independently of stored children. Its cutoff remains on
  the native non-occurrence end date. All local fixture rows and journals are
  removed after native cleanup.
- Only the previously authorized test recipient receives synthetic meeting
  operations. Native RSVP was seeded to exercise reset behavior; guest receipt
  or real guest acceptance is not claimed.
- The first live harness needed its cleanup order corrected for canonical
  parent/child constraints. Its already-removed native fixture and four local
  rows were verified and cleaned before the final successful run.

The existing integration suite now also covers end-date flat/canonical families,
master/later-occurrence targets, earlier/later time, duration/no-op, weekly and
non-occurrence cutoffs, malformed bindings, unsupported exceptions/cancellations,
stale versions, 412, lost responses, accepted recovery and a concurrently changed
native range or pattern. Tests check master-only expansion, stable bindings,
subsequent sync, fresh edit capability and the old capability version shapes.
The counted-series cases remain in the same suite. Series content, occurrence
content and occurrence time suites provide regression coverage.

No database migration, dependency, release, tag or production deployment.

References: [Graph recurrence range](https://learn.microsoft.com/en-us/graph/api/resources/recurrencerange?view=graph-rest-1.0)
and [update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0).
Live behavior is evidence for this bounded implementation, not an atomic
multi-resource snapshot guarantee from Microsoft.

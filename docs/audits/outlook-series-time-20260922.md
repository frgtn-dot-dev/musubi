# Outlook whole-series clock time — 2026-09-22

## Supported behavior

The existing “Edit series” action on web and native can change the clock time and
duration of a counted, finite, same-day UTC series with **no exceptions or cancelled
occurrences**. Both personal and organizer meeting families qualify in the
verified owner's default calendar. Dates, recurrence, IDs and guest identities
stay unchanged. Content can be edited in the same operation.

The time-only controls use the master's first date even when opened from a later
stored occurrence. The individual-occurrence editor remains separate. The
existing invitation help explains possible RSVP reset; no new dialog or visual
system is introduced. Content-only series edits retain their earlier contract,
including preservation of moved, independently edited and cancelled occurrences.

## Why exceptions exclude time editing

Live master start/end PATCH probes revealed a destructive Graph behavior: with
one moved/content exception and one cancellation, the time change removed both
exception and cancellation markers, discarded the exception content, and restored
the cancelled occurrence. Both personal and meeting fixtures behaved this way.
A successful HTTP response alone is therefore insufficient.

Admission and dispatch require a complete plain family. A newly introduced
exception or cancellation before dispatch causes refusal; the adapter never
tries to repair a family by sending additional writes. Full-family reads span
multiple Graph resources, so this remains a bounded conditional-write contract,
not a transactional snapshot of Microsoft's calendar.

## Wire and durable write contract

- `outlookOrganizer=8` adds optional `outlookSeriesContent.time` with the exact
  first UTC start/end. v1–v7 retain their previous shapes; v8 retains earlier
  occurrence capabilities. Both existing organizer/time-edit flags are required.
- The request explicitly names `scope: series` and the complete series version.
  The selected local row's identity, revision and provider-state version are
  still bound. All-day conversion, another zone, changed dates, overnight
  duration, recurrence edits and changes to the set of occurrence dates fail
  before queueing. End-date/UNTIL series do not qualify: their local cutoff
  is tied to the original clock time and needs separate rebinding evidence.
  Existing limits remain 366 slots within 730 days.
- After repeated native and local proof, one minimal master PATCH sends only
  `start`/`end` plus any requested content, with the exact observed `If-Match`.
  It never sends a recurrence replacement, guest list or per-occurrence PATCH.
- Verification requires the same native master and instance IDs/UIDs, exact
  requested times, unchanged recurrence/content/native fields and no exceptions
  or cancellations. Ordinary original slots must move to the new clock time.
  For a real time change only, RSVP may reset to Outlook's verified empty state;
  the full master comparison also checks its sentinel response timestamp and
  unchanged guest identities/roles. All ordinary projected guest states must
  match. No-op/content-only edits cannot use the reset exception.
- The existing `graphOccurrenceContent` journal, pre-dispatch marker, durable
  acceptance, lease checks and calendar import fences are reused. A lost response
  or restart never permits another PATCH. Accepted recovery verifies read-only,
  even if the time flag is subsequently disabled. Definite stale rejection can
  release the fence; uncertain outcomes retain it.
- Completion atomically updates every known active local family member and its
  mapping. Canonical children keep their UUID and series ID while receiving the
  new original slot; provider-expanded imports remain flat. This avoids creating
  duplicate old/new occurrences. Subsequent canonical family sync and a fresh
  edit use the new bindings. No database migration or dependency is added.

## Verification

[Redacted evidence](evidence/outlook-series-time-20260922.json) contains:

- Four new native UTC COUNT=4 probes (personal/meeting, clean/with exceptions).
  Clean families preserve native IDs; changed families lose their exceptions and
  cancellations. Stale master PATCH returns 412. Restore and native cleanup
  succeeded in each case (204 personal, 202 meeting, then GET 404).
- Two new COUNT=3 fixtures through actual Musubi admission, outbox, Graph and
  local completion. Each moves 09:00–10:00 to 13:00–14:30 and back. Native IDs,
  dates, HTML and guest identity survive; all local times and slot bindings are
  checked. Native cleanup and deletion of only fixture rows/journals succeeded.
  An earlier harness run completed its first edit but needed an explicit
  `originalStart` projection for its verification GET; it was also cleaned up.
- Test invitation/update/cancellation recipients were limited to the previously
  authorized address. Seeded native RSVP is used to exercise reset behavior;
  guest receipt or actual guest acceptance is not asserted.

Integration tests cover flat and canonical families, a master target, combined
content/time, duration, no-op, unsupported shapes, both feature gates, stale
admission/delivery, concurrent exceptions, authority/identity changes, 412,
partial/mismatched readback, changed guest/native fields, lost responses,
restart, durable accepted recovery and transient propagation. Tests verify stable
IDs, atomic original-slot rebinding, subsequent sync and availability of a second
edit. Prior series/occurrence content, occurrence time and one-off meeting suites
also pass.

Web and native editor tests cover the master anchor and frozen retry identity.
Chromium checks cover 1280px light and 390px dark, calendar-to-series navigation,
keyboard submission, error/retry, focus return, axe and horizontal overflow.
Repository Playwright was used because the Browser plugin was unavailable.
This is not a physical-device test. Typechecks, scoped lint and CI shard inventory
checks pass.

## Remaining boundaries

Whole-series time edits with exceptions/cancellations, UNTIL/end-date ranges, non-UTC or all-day series,
changing the first date, overnight spans, recurrence-rule changes and “this and
following” remain unsupported. Existing online-meeting, attachment and delegated
calendar exclusions remain. No flags, release, tag or production deployment are
changed by this work.

Reference: [Microsoft Graph update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0).
The destructive exception behavior above is a live observation, not a claimed
atomicity guarantee from that documentation.

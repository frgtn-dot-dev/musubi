# Outlook all-day occurrence dates — 2026-09-22

Extends the verified occurrence editor to **all-day → all-day** moves and
single/multiple-day duration changes. The same date controls are used on web and
native. A date remains a date: device timezone and DST do not shift it.

## Contract

- Existing finite-family observation, owner/default-calendar verification,
  revision/ETag checks, feature flags and calendar import fences still apply.
- The master must have an all-day time model and the target must have a date
  original slot, all-day mode and explicit UTC original-zone labels. Unknown or
  non-UTC all-day authoring zones do not qualify.
- `outlookOrganizer=7` adds `organizerEdit.timeKind: "all-day"` with `timeEdit`.
  v1–v6 keep their previous shapes and do not advertise all-day time editing.
  Existing UTC/Europe/Prague timed capabilities are retained in v7.
- A one-day event has equal inclusive start/end dates in Musubi. The shared
  Graph serializer writes the start midnight and the midnight **after** the end
  date. It writes only `start` and `end`, not `isAllDay`, recurrence or attendees.
- Admission compares occupied dates against both original and moved neighbouring
  occurrences, including cancelled slots. The final occupied day may be the day
  before the next occurrence; the exclusive Graph endpoint may then equal that
  occurrence's start. Crossing a neighbour, reversing dates, changing timed vs
  all-day mode, or overflowing the four-digit Graph year is refused.
- The original occurrence identity never changes. Only exact full-family and
  native readback after durable acceptance commits the new local dates. Lost or
  uncertain dispatches keep the existing no-resend recovery contract.
- A real date change may reset the edited meeting's RSVP responses to Outlook's
  previously verified empty-response sentinel. Guest identity/role, other raw
  fields, the master and every sibling remain checked. A no-op date change does
  not allow RSVP reset. Mail delivery is not asserted.

## Evidence

[Redacted native and application results](./evidence/outlook-occurrence-allday-20260922.json):

- New synthetic personal and organizer-meeting series: move one day to two days,
  restore it, stale ETag rejection (412), neighbour crossing rejection (400),
  unchanged original slot, HTML and siblings. The first meeting probe safely
  rejected a version changed while the invitation settled; a new settled fixture
  then passed. No unconditional retry was used.
- Actual Musubi queue/outbox: two consecutive edits each for personal and meeting
  fixtures, two-day then one-day, with exact native/local dates and observed RSVP.
  Each native family was removed (DELETE 204 / cancellation 202, then GET 404),
  and the corresponding local fixture rows/journals were removed.
- Integration coverage extends the existing occurrence-time suite: flat and
  canonical families, moved/cancelled neighbours, one/multiple days, no-op,
  content combined with dates, mode/zone/flag refusal, stale admission, 412,
  mismatched readback, lost responses, restart/accepted recovery and RSVP reset
  vs unrelated guest changes. Prior timed and content scenarios are retained.
- Shared draft/schema, serializer, web/native editor and details tests;
  API/web/native types and scoped web lint. The native picker keeps the inclusive
  end date and the frozen retry keeps the exact submitted dates.
- Chromium desktop light (1280×900) and narrow dark (390×900): opening from the
  calendar, changing dates, keyboard submission, lost-response/frozen retry,
  focus return, axe, no overflow or runtime error. Existing Prague time flows
  pass alongside them. Browser plugin was unavailable; repository Playwright
  was used. This is not a physical iOS/Android device test.

## Boundaries

This does not enable timed/all-day conversion, whole-series time or recurrence
changes, following edits, additional named zones, online meeting or attachment
write shapes. Feature flag defaults, migrations, dependencies and deployment
remain unchanged. Full Graph family reads still span multiple resources, so an
unrelated concurrent change prevents successful completion.

References: [Graph event update](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0),
[event all-day time semantics](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).

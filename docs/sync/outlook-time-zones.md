# Outlook recurring time zones

Occurrence edits, whole-series clock edits and selected-occurrence moves use
one verified series zone. There is no city allowlist. Windows and IANA labels
are resolved using the vendored Unicode CLDR 48 mapping and the runtime's IANA
rules; the Outlook mailbox must support the labels used for the write.

## Evidence and writes

- Explicit IANA authoring labels take precedence. Windows-only events use CLDR's
  `001` representative, not the user's location or the browser/server zone.
  Saved authored zones must match the native labels. Aliases are matched by
  IANA identity, never by today's UTC offset. Unknown/custom and contradictory
  native labels fail closed.
- Mapping only produces a candidate. The existing complete finite-family reader
  must independently match every native UTC original slot and ordinary start/end,
  including DST. Mapping does not adopt provider-expanded rows as local series,
  or relax unbound recurring-create recovery.
- Keep raw native zone labels in snapshots, version hashes and endpoint PATCHes.
  Only comparison templates normalize them to IANA. Readback still requires the
  exact requested UTC instants and all unrelated native fields unchanged.
- Check mailbox `supportedTimeZones` at observation/admission and before first
  dispatch. Use the requested format, never positional matching of Windows/IANA
  lists. Failed support prevents time writes; series content editing can remain
  available. Accepted recovery only reads the result and never re-sends a PATCH.

## Local-time semantics

The editable zone stays fixed. Explicit times must be unambiguous: a spring gap,
fall fold, fractional-hour transition or skipped civil date is rejected before
any write. Whole-series editing checks every generated slot, not just the first.
A native inclusive `endDate` becomes a UTC UNTIL at the new local clock **on that
final date**, using that date's offset. Numbered/endDate rules and local occurrence
dates stay unchanged. Exceptions/cancellations still block whole-series time
changes, because Graph can reset them.

Selected moves add civil minutes to each local start/end. Both endpoints must
remain on their previous occupied local dates and between neighbouring dates.
UTC midnight is not a date boundary for these checks. The durable preview freezes
the exact resulting instants and uses its initial verified series zone when
admitting children, displaying results, and recovering after restart. Edited and
cancelled occurrences stay untouched; uncertain delivery stops the remaining
items without retrying provider writes.

Existing bounds remain: the owner's default calendar, finite family of at most
366 occurrences within 730 days, no unsupported recurrence/attachment/conference
shapes, and at most 20 selected moves of 1–720 minutes. Timed recurring creation,
zone conversion, non-UTC all-day writes and unlimited series are not added here.

## Client compatibility

Web and native clients request `outlookOrganizer=10`. Only that version receives
arbitrary IANA zones in occurrence/series time capabilities. Earlier clients keep
their UTC or UTC/Prague contracts. The bulk options, preview, latest, read and start
endpoints use the same query opt-in: non-UTC results are hidden/rejected for old
clients **before a start mutation**. Existing UTC journals remain usable.

## Validation and maintenance

Tests cover all 139 CLDR Windows names and their supported IANA aliases, global
gaps/folds, fractional offsets, local/UTC midnight, year boundaries, finite-family
proofs, provider-expanded/canonical rows, persisted dispatch and old-client gates.
Database scenarios cover New York spring/autumn, Sydney, Lord Howe, Kathmandu,
India, Chatham, Kiritimati and Honolulu with a different process time zone.
Existing race, refusal, accepted recovery and uncertain no-resend tests remain.

Live Graph tests used disposable personal New York/Kathmandu series and an
organizer meeting in Sydney across DST. Each whole-series test performed one
master PATCH; each bulk test performed two selected-occurrence PATCHes while
preserving an edited exception, cancellation and master rule. Exact local times
and native labels were read back. Fixtures were removed and GET 404 confirmed.
Notification receipt is not asserted. [Redacted evidence](../audits/evidence/outlook-global-time-zones-20260923.json).

To reproduce the mapping, download the versioned
[CLDR 48 XML](https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml)
and run `python3 scripts/generate-outlook-time-zones.py /path/to/windowsZones.xml`.
The generator verifies its SHA-256; a version update requires explicit source
review. The Unicode license is retained in `packages/calendar/UNICODE-LICENSE.txt`.
Microsoft documents the mailbox API in
[supportedTimeZones](https://learn.microsoft.com/en-us/graph/api/outlookuser-supportedtimezones?view=graph-rest-1.0).

No DB migration, dependency addition, production flag, release or deployment is
part of this change.

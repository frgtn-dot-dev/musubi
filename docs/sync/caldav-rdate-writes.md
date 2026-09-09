# One additional all-day CalDAV date

The existing default-off event-time scope writer supports adding or removing one
`RDATE;VALUE=DATE:YYYYMMDD` on a personal all-day master. This adds an occurrence
that the RRULE does not generate; removing it reverses that addition. It does not
change the rule's COUNT or DTSTART anchor. A COUNT=2 series on March 28–29 with
an additional April 2 date has three occurrences, and returns to two when that
date is removed. The addition inherits the master's original all-day duration.

The accepted source has one VEVENT, one exact plain COUNT RRULE, zero or one
single-value DATE RDATE, no EXDATE, no meeting, and no active or retired detached
history. The RRULE footprint and total occurrence count are bounded to 366 slots
and 730 days. The additional date must be strictly after DTSTART, outside the
rule's generated dates, with its full duration inside the bounded horizon. Every
DATE must be a real calendar date. Duplicate properties/tokens, malformed raw
values, quoted/parameterized RDATE, changing the RRULE, replacing one added date
with a different date in one request, and combining content/time changes are
refused. Timed/floating series, UNTIL, multiple additions, and RDATE/EXDATE
combinations remain unsupported. Existing EXDATE restoration and cancellation
paths keep their previous contracts.

The public request reuses the typed series scope update with a complete desired
recurrence string, exact stored master ID/revision, and operation ID. No new
route, migration, dependency, or activation flag is introduced. Preparation,
transactional admission, immutable intent reconstruction, and native conflict
confirmation all independently require the exact add/remove delta. Ownership,
source identity, positive resource write privilege, strong ETag, lease and local
revision fences remain in force. There is no native overwrite or readdressing.

The writer changes only the selected physical RDATE span or appends its new line
before END:VEVENT. All other raw bytes—including RRULE, dates, unknown extensions,
folding and VALARM—are preserved. Native raw RRULE identity and RDATE multiplicity
are checked before preparation and recovery; normalized recurrence sets cannot
stand in for that proof. A lost acknowledgement is reconciled through the
existing full-resource ACK path. A conflict can explicitly reapply the same saved
date when native structural/time/content evidence still matches; changing that
saved date or adopting an unrelated native edit is not supported. Previous
receipts, local intent, and retry identity remain durable.

Web uses the existing recurrence editor, DatePicker, Row and Button. Native uses
the existing recurrence section and date picker. Both label the action as an
additional *series* date and say that the regular repeat count stays unchanged.
Generated-slot editing receives the separately stored master rather than using
the displayed slot's anchor or synthetic ID as evidence; submission uses the
existing explicit whole-series scope. The full web editor refuses a stale or
missing stored master. No reminder settings or scheduling mode are changed.

## Evidence

- `packages/calendar/src/rdate-edit.test.ts`: exact finite membership and reverse
  removal, anchor/COUNT retention, calendar validity, bounds and unsupported
  structure refusal.
- `apps/api/src/sync/adapters/caldav_rdate.test.ts`: native full-resource add/remove,
  byte preservation, immutable delta and raw malformed/duplicate evidence.
- `apps/api/src/sync/caldav_scope.integration.test.ts`: real public HTTP requests
  and disposable PG journals, local stale CAS, lost ACK, conflict confirmation,
  duplicate native evidence, changed native time, permissions, disabled writer,
  and active/retired child refusal; existing scope regressions also run.
- `apps/api/src/sync/adapters/caldav.radicale.integration.test.ts`: disposable
  Radicale native add/remove, conditional conflict and explicit recovery,
  unchanged extension/alarm/COUNT, replay, full ACK and stable sync echo.
- Native `AddEventModal.spec.ts`: actual generated-slot caller through stored
  master and public scope payload for add/remove on both Android (dialog and
  scope alert) and iOS (inline compact picker and scope action sheet), including
  Android dismiss/reopen, the persistent iOS compact control (no JS dismissal
  callback), selection without writing, and closing after save. Web `month-read.spec.ts`:
  generated-slot to full editor, exact master/revision/scope payload, both
  add/remove in desktop light and narrow dark layouts, with accessibility checks.

No live iCloud/provider account or physical native-device acceptance is claimed.
Broader additional-date editing remains outside this bounded slice.

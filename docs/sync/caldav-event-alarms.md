# CalDAV event alarms

`CALDAV_ALARM_EDITS_ENABLED=false` is an independent default-off gate for the
provider-state editor, durable queue, conflict preparation and worker. The Google
reminder and event-time edit flags do not enable this path. No production or
live iCloud activation is claimed.

## Supported resource

The initial contract is one live personal, nonmeeting VEVENT in one native
resource, with one source mapping and one linked calendar. It requires a known
zoned or all-day canonical time, exact native time/content/UID, and a fresh strong
resource ETag. Floating/legacy time, recurrence, detached occurrences, METHOD,
ORGANIZER and ATTENDEE are refused. A fresh `current-user-privilege-set` must
positively grant `write-content` on the exact resource; absent or denied evidence
never permits editing.

Only zero or one VALARM is editable. A supported existing alarm has exactly one
ACTION:DISPLAY, TRIGGER and DESCRIPTION, and no other properties/components.
TRIGGER is a START-relative elapsed duration of whole minutes at or before the
start, from 0 through 40320 minutes. Hours and whole-minute seconds are accepted;
days/weeks are refused because their nominal calendar duration can cross DST.
The upper bound is a product constraint, not an RFC limit. Explicit RELATED=START
and VALUE=DURATION are supported. Other parameters, absolute/end-relative
triggers, repeated, email/audio, UID, ACKNOWLEDGED, snooze and unknown alarms are
refused as complete resources; they are never silently removed or simplified.

The physical writer edits only the sole TRIGGER line, removes the entire supported
VALARM, or inserts a new DISPLAY alarm with DESCRIPTION:Calendar reminder.
Existing DESCRIPTION and all nonalarm bytes, including folded extensions and
VTIMEZONE, remain untouched. New trigger spelling is normalized to elapsed
minutes. Full native postread evidence accepts only the existing resource
comparison's line-ending/folding and different-property ordering normalization,
not content loss.

## Journal and conflict

`POST /api/v1/events/:eventId/provider-reminders` accepts a distinct strict
`provider: "caldav"` request with `alarms.minutesBeforeStart` (null means off), an
operation UUID, expected canonical revision, and opaque full-resource state
version. Editor admission performs a fresh full GET; saved provider-state alarm
summaries cannot prove support. The digest binds raw bytes, exact source mapping,
resource identity, ETag and local revision. No raw resource/description is exposed
in editor or conflict DTOs.

The private `caldavAlarm` outbox payload retains typed input and full before/after
resource proof. Queue and replacement lock source lifecycle/resource/event,
recheck source membership/mapping and unresolved intents, and preserve canonical
content and revision. The worker rebuilds the saved output, checks the complete
current resource, writes only with If-Match, and requires a full desired postread
before specialized ACK promotes ETag/provider state. A lost response is recovered
from the same complete desired bytes without a second PUT. A stale resource is
never overwritten or moved to another address. Generic content ACK cannot accept
an alarm intent. Positive component/full pulls wait for specialized ACK; retained
deletions and expired leases prevent acknowledgement.

The existing delivery dialog has `caldavAlarmResolution`, displaying saved and
current alarm values. Explicit replacement requires a fresh opaque
`expectedReminderStateVersion`, latest operation, local revision and current
remote ETag. Only the alarm may differ from the saved native baseline. Changes to
other native bytes, even private extensions, conservatively disable replacement;
sync/reopen is required. Replacements retain the same destination and desired
alarm, supersede prior private receipts, and support repeated conflicts/replay.
No canonical edit, social activity, local notification scheduling or copy fanout
is emitted by queue/ACK/replacement.

## Client meaning

Web and native reuse their existing editor and delivery dialog. The label is
“CalDAV event alarms”; there are no Google calendar defaults or email choices.
An event VALARM is stored on the resource and may be visible to other calendar
users. It is not promised to be a private per-user preference. Calendar apps
deliver it; Musubi reminders remain separately scheduled and both may notify.
Only a fresh server-provided editor capability exposes the action.

## Validation and remaining limits

- Pure parser/writer tests cover zoned/all-day, off/add/change, folded DESCRIPTION
  and extension preservation, elapsed bounds and complex/unknown refusal.
- The real HTTP/PostgreSQL fixture covers 30 scenarios: gate/privilege/unsupported
  editor refusal, stale native editor proof, durable replay/overlap, CAS conflict,
  ambiguous response recovery, lease/deletion/grant fences, generic ACK refusal,
  tampered output, pending imports and explicit repeated conflict replacement.
- Disposable local Radicale proves actual positive privilege discovery, native
  conditional PUT/full GET, unchanged resource bytes and canonical revision,
  conflict and explicit alarm removal. It is not iCloud interoperability proof.
- Web/native component tests cover provider semantics, narrow editor controls and
  exact retry identity. Chromium light 1280 and dark 390 tests exercise keyboard
  retry, focus, accessibility and overflow (record results in the delivery log).

Run `pnpm test:db:events`, `pnpm test:caldav:radicale` with a disposable
`RADICALE_URL`, API pure tests and web/native unit tests. The alarm-only fixtures
are `apps/api/src/sync/caldav_alarms.integration.test.ts` and
`apps/api/src/sync/adapters/caldav_alarms.radicale.integration.test.ts`.
No live account, email or notification-delivery claim is part of these tests.

## Stopping an unsupported saved change

When a conflict cannot be applied safely, the connection owner can explicitly
“Discard saved alarm change” from Delivery details. This endpoint accepts only
the exact operation and currently displayed local revision; it rechecks the current source,
account ownership, membership, resource identity and absence of a worker lease. Newer local content
and queued content intents are preserved; discarding an old alarm does not require
the old canonical snapshot to remain unchanged.
It retains immutable journal payloads as `not-needed` with `alarm-discarded`,
sends no native request, and does not promise to undo a previously accepted PUT.
The UI states this distinction in its confirmation and retained receipt.

Pending alarm resources are skipped individually by full/component imports;
other events and the source cursor can continue. ACK or discard clears the cursor
and advances the existing source generation under an exclusive lifecycle lock.
CalDAV event imports, deletions/sweeps and cursor writes validate that captured
generation, so an in-flight old pull cannot overwrite the reset. The next fresh
sync adopts the native event, including unsupported alarms or changed content.
This is an explicit escape from an otherwise unresolvable alarm conflict.

Outbox inserts and private provider-state persistence failures are rethrown
without Drizzle bound SQL/payloads or cause chains. The induced PostgreSQL insert
failure regression checks rollback and the sanitized error boundary.

CalDAV generation fencing does not imply an authoritative full fetch. A missing
collection during the adapter lookup preserves cached events and tasks, including
when the cursor was cleared after a discard. Only an explicitly authoritative
CalDAV reset may sweep missing objects. The HTTP/DB fixture exercises initial
and post-discard missing lookups with all write flags disabled.

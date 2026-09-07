# Event time and occurrence identity (K10)

Status: proposed implementation contract. No production migration or provider parity claim.

## Stored time

Keep existing `start_at` / `end_at` instants and Musubi's inclusive all-day end convention. Add nullable `events.time_model` JSONB, exposed as optional `timeModel` on read DTOs for old caches. Missing/null means **legacy-unknown**, never the server's timezone. A known model is a strict tagged union:

- `{ kind: "zoned", timeZone: "Europe/Prague" }`: start/end remain instants; recurrence advances civil time in this event zone. UTC is the explicit `UTC` zone.
- `{ kind: "floating", startLocal: "2026-09-07T09:00:00", endLocal: "2026-09-07T10:00:00" }`: civil values are authoritative; existing instants are a compatibility projection. Expansion requires an explicit viewer zone; background consumers require the recipient's configured zone.
- `{ kind: "all-day" }`: existing start/end encode inclusive calendar dates, independent of viewer zone. Provider adapters alone convert exclusive end dates.
- `{ kind: "legacy-unknown" }`: explicit unresolved historical semantics. Do not infer an IANA zone from offset, machine locale, account location or server TZ.

A zoned model accepts only a runtime-supported IANA identifier or UTC. Imported custom VTIMEZONE definitions that cannot be represented faithfully stay unresolved with preserved provider source; never silently substitute a zone. New known models must agree with isAllDay and date order. Floating strings are strict valid Gregorian civil timestamps without offset. The current event model has millisecond precision. Accept at most three fractional digits and normalize to three; reject higher precision instead of truncating the anchor. Original instant identities likewise normalize to UTC with three fractional digits, so equivalent text cannot create duplicate occurrences.

Add the read model before enabling writes. Generic create/PATCH cannot mutate occurrence identity. In the schema-first slice, exclude new fields explicitly from derived write schemas; unknown keys continue to fail. Later explicit time edits update start/end/model atomically under revision CAS and enter the immutable outbox snapshot. Old requests omitting metadata preserve it unless their date edit would make it inconsistent; those edits require refresh/explicit conversion rather than stale metadata.

## Occurrences

Add nullable `events.series_id` referencing events and nullable `events.original_start` JSONB. Both exist together only for a detached exception. Original start is a strict tagged identity: `{kind:"instant",value:ISO-with-Z}`, `{kind:"floating",value:civil-timestamp}`, or `{kind:"date",value:YYYY-MM-DD}`. A timed zoned series uses its original occurrence instant. A moved exception preserves this identity, independently of its new start/end. Cancellation retains the exception identity.

Enforce unique `(series_id, original_start)` for exceptions; reject self references, nested exceptions and cross-owner/home-calendar relationships in the authoritative transaction. Do not allow cascading master deletion to bypass durable child delete intents: the scope transaction resolves descendants before removing the master. Existing unrelated detached events remain unrelated; no title/UID/time heuristic backfill.

Use a shared `occurrenceKey(seriesId, originalStart)` for expansion, exception replacement and callers. Provider identity stays on `external_events`: nullable `external_series_id` and `original_start`, alongside resource id, calendar mapping, UID and ETag. Google/Graph provider-specific instance identity and CalDAV RECURRENCE-ID are normalized only within that destination mapping. Two accounts with the same UID never become one series. Existing synthetic IDs remain readable during rollout; write scope requires explicit original identity once supported.

## Expansion and DST

One shared expansion entry point serves web, phone, API reminders and widgets. Zoned results have the same instants in UTC, Europe/Prague and America/New_York viewers; only presentation changes. Floating values resolve in the explicit consumer zone. All-day values remain date based. Legacy behavior is isolated and visibly unresolved rather than relabeled zoned.

Follow RFC5545 section3.3.5 for an explicitly supplied local timestamp: first occurrence for a fold; pre-transition offset for a gap. Follow section3.3.10 for generated recurrence: omit nonexistent local occurrences without counting them toward COUNT. These are different cases. Use zone conversion backed by timezone data, with exact round-trip detection; no one-hour assumption. Preserve UNTIL/COUNT, RDATE/EXDATE and original identities in the series frame. Keep the duration semantics explicit and test start/end crossing offset transitions. Invalid/unsupported recurrence must be reported, not expanded approximately.

Source: [RFC5545](https://www.rfc-editor.org/rfc/rfc5545), sections3.3.5,3.3.10,3.8.4.4. RECURRENCE-ID records the original recurrence start even after a move.

## Delivery sequence and verification

1. Add strict reusable contracts and review this schema proposal. These exported contracts are not yet fields in EventSchema or writable requests. Then add storage, with legacy default, constraints and migration tests; no behavior switch or writable identity yet.
2. Implement exact zone conversion and shared expansion, then pass explicit consumer zone at every caller. Test independent processes under UTC/Prague/New_York, different US/EU DST weeks, gaps/folds, non-hour offsets, COUNT, all-day and floating, moved/cancelled exception replacement and restart-stable identity.
3. Extend revision-CAS writes, DTO projections, immutable outbox/provider projections and both client editors as one coherent contract. Explicit time changes must not silently rewrite unrelated provider fields.
4. Rehydrate provider zone/exception metadata in K11 into existing mappings. Under the same lifecycle lock and mapping/revision/pending-outbox guards as pull, compare source version and commit only if no newer local draft exists. No wipe/reimport, echo outbox or guessed local legacy zones. Record skipped conflicts for later reconciliation.

Each slice needs an independent clean-context PR review and green relevant checks before merge. K10 closes only after all consumers and its acceptance scenarios pass; schema storage alone does not close it.

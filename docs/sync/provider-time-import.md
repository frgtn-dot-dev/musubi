# Provider time and occurrence import

K11 builds on the K10 time model. Import of known time metadata follows the existing `EVENT_TIME_EDITS_ENABLED` gate; it remains off by default and the K10 production compatibility guard still applies. This is implementation evidence, not a production backfill or live-provider certification.

## Google slice

The time-aware event listing requests `showDeleted=true`, preserving Google's cancellation-only exceptions. These records are guaranteed to contain only `id`, `recurringEventId` and `originalStartTime`; they become live `isCanceled` definitions with stable original identity, rather than deleted rows that would resurrect the generated slot. Missing masters are hydrated before any observation is applied. Master errors or invalid identity/time abort fetching without advancing the cursor. Masters precede exceptions regardless of incoming order. A reset retains hydrated masters and cancellation definitions.

Timed recurring definitions require Google's explicit time zone. Offset-only one-offs retain an unresolved zone instead of guessing one. All-day endpoints convert from Google's exclusive end to Musubi's inclusive dates. Known definitions preserve their raw recurrence lines rather than passing through the old UTC approximation. Moved exceptions keep their own title, start and duration.

The authoritative DB writer preserves existing local UUIDs, locks the master before an exception, rejects nested/cross-authority relationships and checks pending operations on the source destination. Unresolved source operations leave the cursor available for retry. The accepted time tuple and provider relationship are committed together. Metadata-only adoption does not create outbound echo for linked copies; real content changes and revivals retain existing durable fanout. A proposed master update must still expand with stored children before it can commit. Family-changing writes require the later atomic scope path.

Provider master deletion tombstones its authoritative children in the same transaction and keeps mappings for stable revival. A pending child operation on the source blocks removal before any write. Derived destination operations do not indefinitely block the authoritative source import; their delivery is a separate durable state. K12 must enable time-aware provider writes before rollout of those writes.

Regression: `apps/api/src/sync/google_occurrences.integration.test.ts` uses real HTTP fixtures, the actual Google adapter and sync engine, and disposable PostgreSQL. It covers reordered master/moved/cancelled records, DST expansion in New York, hydration 503 with unchanged data/cursor, 410 reset, all-day cancellation, metadata adoption with an existing Microsoft-linked destination, invalid master-only deltas, family deletion and identical revival with durable recreate fanout. No live provider mutation is used.

Sources: [Google recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

The documented K11 import contract is locally implemented, including Graph bounded-window identity and client coverage notices below. The explicitly refused CalDAV forms remain follow-up model work. K12 scope writes, K13 meetings and K14 reminder/privacy semantics are not declared complete here.

## CalDAV component slice

With the gate enabled, a complete CalDAV resource produces a master selected by absence of `RECURRENCE-ID` and detached definitions selected by original identity. Incoming component order is irrelevant. Overrides retain their own content and duration; cancellation remains a live suppression definition. IANA, UTC, floating and date values are explicit. All-day exclusive ends become inclusive dates. Accurate duration endpoints retain the second half of a DST fold; nominal days are applied before accurate hours for standalone durations.

The original resource URL remains the master mapping. Override mapping keys combine that URL with the typed original start; their `externalSeriesID` remains the real resource URL. These internal keys are not outbound DAV addresses. Time-aware outbound writes remain blocked until K12 supplies the resource/component-aware writer.

Each complete resource is stored in one transaction. Omitted overrides are tombstoned with their mappings retained, allowing the original generated slot to return and later revival to reuse the same local UUID. The complete family is locked before checking source pending operations. A pending master or omitted override blocks the entire observation. No component ETag is accepted on rollback. A recurrence can be removed together with all its overrides. Incomplete multiget responses fail before a cursor or reset sweep is accepted.

Reading does not serialize or write the resource: `VTIMEZONE`, alarms, attendee properties and unknown extensions remain untouched at the provider. This is read/preserve evidence, not support for editing those fields. Mixed UIDs, duplicate masters/occurrence identities, unsupported TZIDs, masterless overrides, `RANGE` overrides and timed recurring nominal-day/week `DURATION` are explicitly refused. The last three are valid provider forms requiring follow-up model/scope work; they are not silently approximated or declared supported.

Evidence: `caldav_time.test.ts` covers component order, content, dates/floating, DST durations and explicit refusals. `caldav_occurrences.integration.test.ts` covers atomic replacement, omitted overrides, stable revival, rollback including ETags and pending family members on disposable PostgreSQL. `caldav.radicale.integration.test.ts` exercises actual HTTP through Radicale, the adapter, sync engine and DB: reset/delta, deletion/revival, stable identity and unchanged server bytes including alarms/extensions. The local isolated Radicale 3.8.0 run passed; this does not certify iCloud or another live account.

Sources: [CalDAV calendar object resources](https://www.rfc-editor.org/rfc/rfc4791#section-4.1), [iCalendar duration](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.6).

## Graph occurrence mapping slice

Graph's bounded `calendarView` remains provider-expanded: a fetched master supplies inherited content but is never inserted as a second locally expanded RRULE. Each instance mapping retains `seriesMasterId` and its original UTC start independently of a moved start. Existing local UUIDs/revisions survive metadata adoption and reset. Cancellation/removal tombstones the provider-expanded row, so no generated local slot reappears. The existing limited history window is unchanged.

Exceptions and records lacking original identity are hydrated from their calendar-scoped instance endpoint before applying the fetch. An instance never inherits the master's ETag. Dependency failure and identity mismatch leave the cursor unchanged. ISO timestamps with redundant zero precision normalize to milliseconds; nonzero sub-millisecond occurrence identity is refused rather than collapsed. Repeated 410 on a fresh window terminates with an error instead of looping indefinitely.

These are destination mapping fields, not a fabricated local master or event time zone. Native scope resolution and precise Graph recurrence conversion remain K12. Web/mobile expose the imported coverage limitation as described below; complete history is not promised.

Evidence: `graph_occurrences.integration.test.ts` runs actual HTTP fixtures through the Graph adapter, sync engine and disposable DB. It covers legacy adoption, moved content/duration, no double expansion, master/instance ETag separation, repeated and 410/full resets, hydration failure, exact original identity and stable revival. No live Microsoft account was changed.

Source: [Microsoft Graph event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).

## Visible Graph coverage limitation

Web calendar views and native calendar/agenda/detail display a persistent coverage notice when an active Outlook event calendar is included. The notice remains present for empty distant dates, so absence of imported rows is not represented as complete provider history. Hiding those calendars or showing task-only sources removes the notice. It deliberately does not invent exact coverage endpoints from the viewer's current date or a stale client cache.

Evidence: the `explains bounded Outlook coverage on an empty distant calendar` Playwright scenario checks an empty 2035 month, wide/narrow layouts, axe and hiding the provider calendar. The shared banner has a Storybook status-region check. Native callers use the same coverage predicate and were typechecked; physical-device visual testing is still a release gate.


## Google endpoint-zone boundary

The explicit local model carries a single IANA zone for both endpoints. A Google
resource with an independently specified end zone different from its start (or
inherited series) zone is rejected before import/cursor advancement. Projecting
both endpoints through the start zone would erase a provider change and could
falsely classify it as an in-flight reminder echo. Native reminder reads and PATCH
evidence apply the same restriction; different equal-offset zone names are not
interchangeable. These resources need an extended model before explicit support.

## Graph master time candidates

The recurring-create preparation now has a strict native master-time reader and
a civil-time serializer in `microsoft_time.ts`. The reader requires a complete
active `seriesMaster` time shape with an explicit UTC response projection. Timed
masters require an IANA recurrence zone; supplied original endpoint zones must
agree. Windows/custom zones and viewer-zone inference are not accepted. All-day
masters currently require UTC date boundaries and convert Graph's exclusive end
to Musubi's inclusive last date.

The serializer verifies that canonical instants match their known civil anchors.
Ambiguous folds and nonexistent gap anchors are rejected through Temporal's
`reject` disambiguation, including non-hour transitions and skipped dates. Native
seven-digit fractions are accepted only when digits beyond milliseconds are zero.
The existing recurrence candidates now use this check before converting a rule,
so an inconsistent master cannot produce an apparently valid pattern.

Unit evidence includes independently specified native UTC payloads, Prague DST
expansion under three host zones, multi-day/year-boundary all-day events, both
sides of a fold, Lord Howe half-hour transitions, Apia's skipped day, malformed
dates and precision loss. This is candidate evidence, not a complete native event
or write-authority proof. Existing provider-expanded import and recurring-create
refusal are unchanged; durable create recovery and master/instance echo handling
remain required before enabling the capability.

Sources: [Graph event](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0),
[dateTimeTimeZone](https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone?view=graph-rest-1.0),
[create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0).

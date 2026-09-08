# Provider time and occurrence import

K11 builds on the K10 time model. Import of known time metadata follows the existing `EVENT_TIME_EDITS_ENABLED` gate; it remains off by default and the K10 production compatibility guard still applies. This is implementation evidence, not a production backfill or live-provider certification.

## Google slice

The time-aware event listing requests `showDeleted=true`, preserving Google's cancellation-only exceptions. These records are guaranteed to contain only `id`, `recurringEventId` and `originalStartTime`; they become live `isCanceled` definitions with stable original identity, rather than deleted rows that would resurrect the generated slot. Missing masters are hydrated before any observation is applied. Master errors or invalid identity/time abort fetching without advancing the cursor. Masters precede exceptions regardless of incoming order. A reset retains hydrated masters and cancellation definitions.

Timed recurring definitions require Google's explicit time zone. Offset-only one-offs retain an unresolved zone instead of guessing one. All-day endpoints convert from Google's exclusive end to Musubi's inclusive dates. Known definitions preserve their raw recurrence lines rather than passing through the old UTC approximation. Moved exceptions keep their own title, start and duration.

The authoritative DB writer preserves existing local UUIDs, locks the master before an exception, rejects nested/cross-authority relationships and checks pending operations on the source destination. Unresolved source operations leave the cursor available for retry. The accepted time tuple and provider relationship are committed together. Metadata-only adoption does not create outbound echo for linked copies; real content changes and revivals retain existing durable fanout. A proposed master update must still expand with stored children before it can commit. Family-changing writes require the later atomic scope path.

Provider master deletion tombstones its authoritative children in the same transaction and keeps mappings for stable revival. A pending child operation on the source blocks removal before any write. Derived destination operations do not indefinitely block the authoritative source import; their delivery is a separate durable state. K12 must enable time-aware provider writes before rollout of those writes.

Regression: `apps/api/src/sync/google_occurrences.integration.test.ts` uses real HTTP fixtures, the actual Google adapter and sync engine, and disposable PostgreSQL. It covers reordered master/moved/cancelled records, DST expansion in New York, hydration 503 with unchanged data/cursor, 410 reset, all-day cancellation, metadata adoption with an existing Microsoft-linked destination, invalid master-only deltas, family deletion and identical revival with durable recreate fanout. No live provider mutation is used.

Sources: [Google recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Graph bounded-window identity and the explicitly unsupported CalDAV forms remain K11 follow-up work. K12 scope writes, K13 meetings and K14 reminder/privacy semantics are not declared complete here.

## CalDAV component slice

With the gate enabled, a complete CalDAV resource produces a master selected by absence of `RECURRENCE-ID` and detached definitions selected by original identity. Incoming component order is irrelevant. Overrides retain their own content and duration; cancellation remains a live suppression definition. IANA, UTC, floating and date values are explicit. All-day exclusive ends become inclusive dates. Accurate duration endpoints retain the second half of a DST fold; nominal days are applied before accurate hours for standalone durations.

The original resource URL remains the master mapping. Override mapping keys combine that URL with the typed original start; their `externalSeriesID` remains the real resource URL. These internal keys are not outbound DAV addresses. Time-aware outbound writes remain blocked until K12 supplies the resource/component-aware writer.

Each complete resource is stored in one transaction. Omitted overrides are tombstoned with their mappings retained, allowing the original generated slot to return and later revival to reuse the same local UUID. The complete family is locked before checking source pending operations. A pending master or omitted override blocks the entire observation. No component ETag is accepted on rollback. A recurrence can be removed together with all its overrides. Incomplete multiget responses fail before a cursor or reset sweep is accepted.

Reading does not serialize or write the resource: `VTIMEZONE`, alarms, attendee properties and unknown extensions remain untouched at the provider. This is read/preserve evidence, not support for editing those fields. Mixed UIDs, duplicate masters/occurrence identities, unsupported TZIDs, masterless overrides, `RANGE` overrides and timed recurring nominal-day/week `DURATION` are explicitly refused. The last three are valid provider forms requiring follow-up model/scope work; they are not silently approximated or declared supported.

Evidence: `caldav_time.test.ts` covers component order, content, dates/floating, DST durations and explicit refusals. `caldav_occurrences.integration.test.ts` covers atomic replacement, omitted overrides, stable revival, rollback including ETags and pending family members on disposable PostgreSQL. `caldav.radicale.integration.test.ts` exercises actual HTTP through Radicale, the adapter, sync engine and DB: reset/delta, deletion/revival, stable identity and unchanged server bytes including alarms/extensions. The local isolated Radicale 3.8.0 run passed; this does not certify iCloud or another live account.

Sources: [CalDAV calendar object resources](https://www.rfc-editor.org/rfc/rfc4791#section-4.1), [iCalendar duration](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.6).

# Provider time and occurrence import

K11 builds on the K10 time model. Import of known time metadata follows the existing `EVENT_TIME_EDITS_ENABLED` gate; it remains off by default and the K10 production compatibility guard still applies. This is implementation evidence, not a production backfill or live-provider certification.

## Google slice

The time-aware event listing requests `showDeleted=true`, preserving Google's cancellation-only exceptions. These records are guaranteed to contain only `id`, `recurringEventId` and `originalStartTime`; they become live `isCanceled` definitions with stable original identity, rather than deleted rows that would resurrect the generated slot. Missing masters are hydrated before any observation is applied. Master errors or invalid identity/time abort fetching without advancing the cursor. Masters precede exceptions regardless of incoming order. A reset retains hydrated masters and cancellation definitions.

Timed recurring definitions require Google's explicit time zone. Offset-only one-offs retain an unresolved zone instead of guessing one. All-day endpoints convert from Google's exclusive end to Musubi's inclusive dates. Known definitions preserve their raw recurrence lines rather than passing through the old UTC approximation. Moved exceptions keep their own title, start and duration.

The authoritative DB writer preserves existing local UUIDs, locks the master before an exception, rejects nested/cross-authority relationships and checks pending operations on the source destination. Unresolved source operations leave the cursor available for retry. The accepted time tuple and provider relationship are committed together. Metadata-only adoption does not create outbound echo for linked copies; real content changes and revivals retain existing durable fanout. A proposed master update must still expand with stored children before it can commit. Family-changing writes require the later atomic scope path.

Provider master deletion tombstones its authoritative children in the same transaction and keeps mappings for stable revival. A pending child operation on the source blocks removal before any write. Derived destination operations do not indefinitely block the authoritative source import; their delivery is a separate durable state. K12 must enable time-aware provider writes before rollout of those writes.

Regression: `apps/api/src/sync/google_occurrences.integration.test.ts` uses real HTTP fixtures, the actual Google adapter and sync engine, and disposable PostgreSQL. It covers reordered master/moved/cancelled records, DST expansion in New York, hydration 503 with unchanged data/cursor, 410 reset, all-day cancellation, metadata adoption with an existing Microsoft-linked destination, invalid master-only deltas, family deletion and identical revival with durable recreate fanout. No live provider mutation is used.

Sources: [Google recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

CalDAV component preservation and Graph bounded-window identity are the next K11 slices. K12 scope writes, K13 meetings and K14 reminder/privacy semantics are not declared complete here.

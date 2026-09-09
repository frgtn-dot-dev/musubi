# Event scope operations

K12 starts with a strict request contract and a pure local-family planner. This first slice adds no endpoint, database writer or provider capability; existing unsafe-write gates stay in place.

A request names one stable operation UUID, the master revision, action (`update` or `delete`) and scope (`occurrence`, `following`, `series`). Occurrence/following requests also name the original typed start and the existing override revision, or explicit null for a generated occurrence. A whole-series time intent is anchored at the stored master; clients must translate a displayed occurrence edit before submitting it. Event identity, calendar membership and meeting authority are not writable patch fields.

The planner receives a complete live local family and produces creates, updates and deletions without changing input. Its caller must authenticate, lock and re-read that family, reserve/replay the operation identity, persist the complete result atomically and append any supported outbound work in that same transaction. The planner itself does not make repeated calls idempotent, authorize provider writes or claim distributed atomicity.

Occurrence deletion creates or updates a cancellation definition; it does not remove the suppression and resurrect the original slot. Moved exceptions retain their own content and duration. Whole-series changes preserve override content while moving original identities with the master anchor; an unchanged anchor preserves exact DST fold identity. A following split partitions COUNT by actual generated starts, preserves UNTIL, keeps the old master for the earlier segment and reparents later exceptions. Cutting at the first occurrence uses whole-series semantics. No-op edits produce no writes.

This initial planner requires known zoned, floating or all-day models. Following requires one RRULE; dated additions/exclusions require later explicit partition support. Moving a series anchor with RDATE/EXDATE is refused rather than leaving stale dates. Any recurrence or anchor change that would orphan an existing exception is also refused. Existing orphan definitions remain readable and are not silently deleted by unrelated content edits. These unsupported cases are visible limitations, not implemented support.

Regression: `packages/calendar/src/scope-plan.test.ts` covers all three scopes for edit/delete, original and moved instances, child/master CAS, COUNT/UNTIL, first/later cuts, floating/date/zoned time, skipped DST gaps, second-fold identity, no-op, ID collision and explicit unsupported/orphan refusals. The server transaction, durable operation replay, provider scope writes and client conversion remain the next K12 slices.

## Atomic local persistence

`applyLocalEventScope` is an internal local-only transaction: it locks actor/operation identity, fences calendar lifecycle, locks the master and all children, rechecks current edit permission and revisions, then commits the complete plan with a durable replay receipt. Receipts contain only IDs and committed revisions; even replay requires current permission. A conflicting reuse of the same operation ID is refused. Provider destinations, mappings and outbound history are rejected until provider-aware execution exists.

Soft-deleted exception IDs are reused when their original slot is edited again, with the master's current calendar links. Following creates its new head before reparenting children. Original-start uniqueness is normally immediate; this transaction defers it until commit so adjacent exceptions can shift through one another's old positions without accepting a duplicate final identity. Tombstones still reserve their identities. No-op requests persist a replay receipt without incrementing event revisions.

The DB integration suite covers concurrent identical replay, distinct-operation CAS races, rollback without receipts, following reparenting, adjacent identity shifts, cancellation/deletion replay, stale calendar link removal on revival, provider refusal, permission revocation and receipt visibility from a new database connection. HTTP publication, client submission and provider scope delivery remain follow-up work; this helper itself sends no notifications.

## HTTP contract

`POST /api/v1/events/:eventId/scope` accepts the strict scope request under the existing explicit-time feature gate. The target is the stored master UUID. A successful response returns operation ID, `changed`, committed `events`/`deleted` ID-revision pairs, `localCommitted: true` and `replayed`. Clients refresh their normal event data after this receipt; the response does not cache private historical snapshots. Replaying a deleted family still works while its tombstones and current authority are retained.

Malformed or unsupported planner intent and operation-ID reuse with different input return 400; stale master/child revisions return 409 with `localCommitted: false`. A failure in post-commit publication returns 502 with the committed receipt and `localCommitted: true`. Retry uses the same request/operation ID. SSE publication uses existing revision-aware frames; provider or notification delivery is not implied by the durable local receipt.

## Client scope submission

Known-series edits and deletions in the web detail popover and native composer/detail use the scope endpoint. Native detached occurrences resolve their master and still ask for scope. Frozen occurrence identity and request content retain the same operation ID when a form reconstructs an unchanged draft for retry. Successful receipts refresh event data instead of installing partial optimistic family rows. A failed refresh preserves local commit truth and the draft.

The native composer receives the reconciled target definition, so a reminder selected while splitting goes to the new head/exception. Its scope requests use `ensureDefinition` for occurrence/following edits: an unchanged event can still materialize the necessary personal-reminder target. Ordinary no-op scope requests stay no-op. First-occurrence following scope still targets the existing master. The web does not offer an unsafe inverse operation or promise Undo for these new deletions.

Remaining client boundaries: legacy recurrence still uses the gated legacy path; full-editor whole-series time conversion retains its existing `/time` path and limitations. Known-model drag/resize remains gated where civil intent is unavailable. Provider scope writes are still refused by the local transaction.

## Graph recurrence candidates

The pure `microsoft_recurrence.ts` converter maps one RRULE into the six documented Graph pattern forms and numbered/end-date/unbounded ranges. It explicitly supplies RFC's Monday week start. Inclusive Graph end dates are derived in the event zone; an UNTIL before that day's event start excludes that day. The original master must match the pattern so Graph cannot omit a DTSTART that local expansion includes.

Unknown terms, dated additions/exclusions, floating time, multiple relative weekdays, fifth ordinals and unverified month-end behavior remain refused. This converter is deliberately not connected to remote delivery yet: native Graph create also needs master-echo deduplication, while update requires verified conditional-write behavior. A successful conversion alone is not a write capability.

Primary references: [Graph recurrencePattern](https://learn.microsoft.com/en-us/graph/api/resources/recurrencepattern?view=graph-rest-1.0), [Graph recurrenceRange](https://learn.microsoft.com/en-us/graph/api/resources/recurrencerange?view=graph-rest-1.0). Candidate tests cover all six shapes, COUNT/UNTIL, week-start and zone-boundary behavior, plus lossless refusals.


### Native Graph recurrence evidence candidate

`recurrenceFromGraph` now reconstructs the supported single RRULE from a strict
native pattern/range and an independently verified known master time. Native
weekly patterns default to Sunday, whereas the existing forward conversion
explicitly supplies Monday for an omitted RFC WKST. Relative patterns support
one weekday and the documented first-index default. Inclusive end dates become
an event-zone cutoff, with no viewer-zone or Windows/IANA guessing. Unresolved
DST cutoffs, mismatched range anchors/zones, unknown fields, non-neutral inactive
fields, ambiguous patterns and unverified month-end behavior are refused.

The reverse candidate reuses forward anchor-membership restrictions and checks
that both directions represent the same active native fields. Independent
expansion fixtures pin actual dates for all six patterns, all-day ranges,
Prague spring DST and New York autumn DST, including three process time zones.
The original provider object is not changed. This is a pure prerequisite only:
Graph calendarView stays provider-expanded, recurring create stays disabled,
and canonical master echo identity/deduplication still needs integration and
HTTP/DB evidence before any capability is exposed. No live account was used.

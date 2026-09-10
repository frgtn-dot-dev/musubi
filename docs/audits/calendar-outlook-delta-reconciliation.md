# Outlook create ACK and missing incremental deletion

## Verified local contract

During the September 10, 2026 live acceptance, a meeting created through
Musubi was cancelled in native Outlook before a subsequent successful pull.
The later incremental response did not remove its local mirror; a completed
full snapshot reconciled the missing event. The first intervening pull had
failed while hydrating an unrelated occurrence's `originalStart`.

The organizer worker can acknowledge creation and persist an external mapping
without changing the source's earlier delta cursor
(`packages/db/src/queries/event-outbox-delivery.ts`). An empty incremental
response correctly leaves that mapping's local event intact. Only a tombstone
or authoritative full reconciliation supplies deletion evidence
(`apps/api/src/sync/engine.ts`, `packages/db/src/queries/external.ts`). This
creates a recovery gap when the incremental stream does not report deletion
of a mapped event introduced by a create ACK.

Microsoft documents snapshot-based delta tokens, removal records, and variable
processing delays. The inspected official documentation does not establish
that create and delete between pulls are coalesced into silence. Coalescing is
an unverified explanation; the fixture below injects the observed missing
change, not a claim about Graph's implementation.
[Microsoft delta query overview](https://learn.microsoft.com/en-us/graph/delta-query-overview)

## Deterministic regression and recovery

`apps/api/src/sync/microsoft_create_delta_reconciliation.integration.test.ts`
uses the standard organizer queue and delivery worker with every Graph request
intercepted. It establishes a cursor before creation, acknowledges creation,
returns an empty delta, then requests a guarded source reset and completes a
full snapshot without the event. It checks removal, retained mapping identity,
unchanged completed creation journal, and no repeated organizer POST. A
pending-write variant checks that the local event and accepted payload remain,
with absence retained as a provider conflict for resolution.

The existing recovery is `setCursor(calendarID, null, accessContext)` followed
by the normal pull. Source revision and lifecycle guards remain required.
Resetting a cursor is not itself deletion evidence; the full fetch must succeed.
The standard pull is account-wide, even when only one source cursor is reset.

## Deferred scheduled repair

A separate reliability change may add occasional source-scoped authoritative
reconciliation. It should retain existing lifecycle/access checks and pending
intent protections, finish every snapshot page before sweeping, and avoid
provider writes. Its design must fence or retain create ACKs that arrive while
a snapshot is in flight so a newly acknowledged meeting cannot be mistaken
for an absent event. Cadence, rate limits, bounded-window semantics, and
retry behavior need explicit tests before enabling it.

This audit adds no repair scheduler or production behavior change. It does not
recommend clearing the cursor after every create ACK: concurrency and snapshot
completeness require a separate design.

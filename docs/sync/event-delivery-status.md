# Event delivery receipts

`GET /api/v1/events/:eventId/delivery` requires the existing authenticated client
version gate. The response uses `EventDeliverySchema` from `@musubi/types` and is
`private, no-store`. It is reconstructed from PostgreSQL on every request; request
success, process memory and optimistic client state are not delivery evidence.

## Visibility

- A current calendar member sees only destinations on calendars they can access
  and to which the event is currently linked. Membership in one calendar does not
  expose the event's other private destinations.
- A destination owner can also read their own retained receipts after an unlink,
  event purge or connection removal. Private payloads, provider snapshots, account
  identifiers, resource addresses, ETags and raw error messages are never returned.
- Authorization and status are read in one read-only, repeatable-read transaction.
  A revoked membership applies on the next request. Inaccessible and absent
  events both return 404; receipt ownership alone does not expose the current
  event revision.

## Meaning

Each target has an opaque connection-generation `targetId`, local `calendarId`,
provider, and `connected`/`owned` flags. These flags describe the destination, not
permission to mutate it. Every future action must authorize independently.

`operationId`, `action`, `revision` and `status` describe the first unresolved
operation for that destination. Thus a blocked write followed by a queued edit
remains visibly blocked. A cancelled predecessor is also reported when a queued
successor still depends on it: cancellation does not satisfy the worker's
completed/not-needed prerequisite. If there is no unresolved operation, they describe its
latest receipt. `latestRevision` additionally identifies the latest queued or
settled local revision. `retryAt` is a scheduler due time, not a delivery promise.

`completed` confirms only the reported operation/revision. It does not assert
that all targets, unseen private targets, or a newer local revision were delivered.
There is deliberately no global `synchronized` boolean. `unknown` means the current
destination has no outbound receipt, as with historical imports; a mapping alone
cannot manufacture a successful receipt. An empty target list does not confirm any
remote write. `localRevision` is null when only retained receipts are accessible.

Replacing a connection produces a distinct target. A previous generation's
receipt cannot confirm the replacement. Removed generations remain visible only
to their receipt owner, with `connected: false` and no current calendar name.

The optional `issue` is a bounded display reason, including reconnect, denied or
unsupported writes. Raw provider errors are never included. Historical generic
errors remain generic; they cannot be relabeled as a known reconnect requirement.

## Explicit retry

`POST /api/v1/events/:eventId/delivery/:operationId/retry` accepts no operation
changes. It checks the receipt owner, current calendar ownership/membership and
the exact live provider/account/calendar connection generation inside the
calendar lifecycle and event transaction. A matching read receipt is not action
authorization. Unknown/foreign operations return 404; disconnected/cancelled,
conflicting or predecessor-blocked operations return 409 with a bounded code.

Admission returns 202 and the current `EventDeliverySchema`. It does not confirm
a remote write. Existing completed operations and active leases are idempotent;
an active lease is never reset. The accepted payload, remote baseline, identity,
uncertainty and persisted Retry-After are retained. Legacy `unconfirmed` status
also forces reconciliation even if its stored uncertainty flag is false.

The existing dispatcher receives a best-effort immediate wakeup after commit;
the existing scheduler recovers persisted work after process termination. The
worker claims due operations, rechecks provider permissions and uses the same
lost-response reconciliation and conditional writes. Manual retry cannot shorten
a provider delay. With automatic external sync disabled, future-due work still
requires a later explicit retry or re-enabling the scheduler. Completion emits
the existing `external_sync` invalidation to the receipt owner and current members.

Retry never resolves a retained remote conflict or authorizes an overwrite.
Explicit conflict resolution and both client integrations remain subsequent K09
work; K09 stays open until their acceptance scenarios pass.

## Evidence

`apps/api/src/handlers/event_delivery.integration.test.ts` exercises the real
authenticated HTTP handler and disposable PostgreSQL: per-target mixed outcomes,
blocked predecessor visibility, untracked imports, private destination and payload
isolation, membership revocation, fresh API instance reads, replacement generations
and retained unconfirmed deletion after event purge. Retry cases cover ownership,
connection/capability replacement, concurrent requests, active leases, immutable
payload/baseline, Retry-After, uncertainty and conflict refusal. It runs in
`test:db:events`. The worker integration additionally verifies explicit recovery
after a lost response, a still-denied permission, restored permission and 429.

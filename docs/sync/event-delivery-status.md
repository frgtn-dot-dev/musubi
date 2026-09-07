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
remains visibly blocked. If there is no unresolved operation, they describe its
latest receipt. `latestRevision` additionally identifies the latest queued or
settled local revision. `retryAt` is a scheduler due time, not a delivery promise.

`completed` confirms only the reported operation/revision. It does not assert
that all targets, unseen private targets, or a newer local revision were delivered.
There is deliberately no global `synchronized` boolean. `unknown` means the current
destination has no outbound receipt, as with historical imports; a mapping alone
cannot manufacture a successful receipt. An empty target list confirms no remote
write. `localRevision` is null when only retained receipts are accessible.

Replacing a connection produces a distinct target. A previous generation's
receipt cannot confirm the replacement. Removed generations remain visible only
to their receipt owner, with `connected: false` and no current calendar name.

This read-only slice does not expose retry or conflict overwrite actions. Those
require their own authorization, fresh provider evidence and durable intent; K09
also remains open until web and mobile consume the contract and pass acceptance.

## Evidence

`apps/api/src/handlers/event_delivery.integration.test.ts` exercises the real
authenticated HTTP handler and disposable PostgreSQL: per-target mixed outcomes,
blocked predecessor visibility, untracked imports, private destination and payload
isolation, membership revocation, fresh API instance reads, replacement generations
and retained unconfirmed deletion after event purge. It runs in `test:db:events`.

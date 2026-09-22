# Outlook recurring meeting cancellation — 2026-09-22

## Result and scope

Organizer cancellation now supports one occurrence or the entire finite series,
including provider-expanded imports without a locally stored master. Web and
native clients offer the same two scopes and explicitly state that Outlook will
notify guests. Existing one-off cancellation and personal recurring deletion are
unchanged. There is no database migration or production deployment in this change.

The capability requires an active owner connection to the verified default
Outlook calendar, complete organizer/guest evidence, one authoritative local
calendar membership per event, and a complete native series. The existing family
reader bounds this to 366 slots within 730 days and explicitly known time zones.
Moved exceptions and UTC all-day families are supported. Indefinite series,
unsupported Windows/custom zones, online meetings and attendee copies remain
unavailable; this is not a general promise that every Outlook series is editable.

## Write and synchronization boundaries

- `outlookOrganizer=2` opts into the additional `outlookCancellation` capability.
  Earlier clients, including v1 clients with strict response schemas, never
  receive that field. The request binds the local revision, provider state and an
  opaque hash of the complete family observation and verified Graph identity.
- Canonical and expanded-only local families keep their existing representation.
  A moved instance is bound by its native ID and original slot, never its new
  display date. An imported all-day UTC instant is compared as a date slot.
- Preparation and dispatch verify the source account, owner grant, membership,
  link generation, complete native family and target versions. Graph cancellation
  still has the preflight race documented in the prior live audit; `If-Match` is
  sent but is not treated as an atomic conditional cancellation guarantee.
- The private journal stores a permanent marker **before** POST `/cancel` and a
  separate durable marker for HTTP 202. A restart or lost response only rereads;
  it never resends that cancellation. HTTP 202 alone is not completion: the full
  family must show exactly the requested cancellation and unchanged survivors,
  or a verified missing master for entire-series cancellation.
- The local cancellation is applied after the full native confirmation, in the
  same transaction as journal completion. Until then the existing event remains
  visible and Delivery details show the pending/uncertain outcome.
- Calendar synchronization is fenced while cancellation is pending or uncertain,
  so it cannot replace the saved family behind the worker. Generic completion,
  conflict rebase and resend cannot acknowledge this private operation. A lost
  HTTP 202 remains unresolved even if the remote event disappeared: absence
  alone does not establish that this request was accepted. Read-only retries do
  not claim guest mailbox delivery.
- A provably undispatched conflict is terminally stopped, releases the sync fence
  and cannot be retried. Reopening fresh state creates a new operation without
  an artificial predecessor dependency. Marked uncertain requests retain their
  fence and require reconciliation; no timeout discards them automatically.
- Completed cancellations reject late active calendarView echoes, including
  other expanded siblings of a cancelled master. Canonical whole-series sync
  skips the cancelled definition.

## Verification

The synthetic integration suite covers flat and canonical families, whole-series
and occurrence cancellation, moved exceptions, all-day slots, incomplete native
pages, stale admission, stale master/sibling data, local revision races, revoked
permissions, swapped Graph identity, lost-applied/lost-retained responses, crash
recovery, durable-202 recovery, changed survivors, generic ACK rejection, late
pulls, exact request replay and subsequent whole-series cancellation. A stopped
preflight request can be replaced from refreshed state.

Live evidence: [redacted implementation result](evidence/outlook-recurring-cancellation-20260922.json).
One disposable UTC COUNT=3 organizer series invited the user-approved test
recipient. The actual DB → outbox → Graph implementation cancelled its middle
occurrence, verified both survivors, then cancelled the remaining series and
verified native absence. Test rows were removed. Guest email delivery was not
observed and remains unknown. An earlier harness run omitted Graph's explicit
`originalStart` selection; that disposable series was cancelled during cleanup
before repeating the corrected test.

Browser coverage exercises the existing scope dialog in light desktop and dark
narrow layouts, accessible keyboard actions, layer order, no horizontal overflow,
focus return, and preservation of the exact operation/scope after a lost response.
Native coverage checks fresh capability reads, the native scope chooser, dismissal,
revoked/stale capability rejection and the same frozen request on retry.

## “This and following”

This scope remains disabled. Microsoft's cancellation endpoint addresses a single
event/occurrence ID or a master, not a boundary inside a series. Implementing it
requires either truncating the existing recurrence while preserving previous and
moved exceptions, or multiple independently journaled cancellations. Neither is
an atomic split, and invitation/update behavior needs a separate live verification
before exposing the scope. This is an implementation boundary, not a claim that
Graph cannot express the underlying operations.

References:
- [Microsoft Graph: cancel event](https://learn.microsoft.com/en-us/graph/api/event-cancel?view=graph-rest-1.0)
- [Microsoft Graph: update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0)
- [Earlier live conditional-write and deletion evidence](outlook-series-meetings-20260922.md)

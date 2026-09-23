# Outlook attendee occurrence RSVP — 2026-09-23

Adds an explicit `outlookRsvp=1` capability and `scope: "occurrence"` request
for an imported, provider-expanded Outlook attendee occurrence. Old clients
retain their earlier capability shape. Web/native reuse the existing editor.

## Native findings

Disposable Google invitations to the authorized Outlook test mailbox used a
three-day America/New_York series spanning the November DST transition. The
actual Musubi admission, queue and worker were exercised against Graph, with
isolated local fixture rows. No production settings were changed.

On an unanswered series, a target-only Tentative POST changed the master's
`notResponded` state to `tentativelyAccepted`, inherited by the other two slots.
The original strict readback correctly remained unconfirmed and never resent.
This is not an acceptable success for an action labelled as one occurrence.
The implementation now refuses an unanswered/declined master before admission
and before first dispatch. The public capability is withheld. The participant
must first respond to the series in Outlook.

The first RSVP also materialized an exception with a new `createdDateTime`.
Only this occurrence-to-exception transition may refresh two valid creation
timestamps. Existing exceptions, one-off events, missing/invalid timestamps,
IDs, UID, parent, original slot, content, time and other participants stay strict.

On the now-tentative master, Accept changed only the selected target's response,
availability and materialization metadata. Master exception bookkeeping changed
as expected in an explicit expanded read. Decline removed its own copy (404),
which remains **unconfirmed / copy unavailable**, not proof of delivery. The
original probe's positive acknowledgements were blocked by the creation-time
difference; final live verification of the corrected path is pending.

All three actions used exactly one POST despite a subsequent read-only check.
The disposable series were cancelled at the Google organizer and cancellation
was read back; isolated local fixture rows were removed. Two earlier harness
attempts ended early (receipt ID lookup and a strict parent assertion); their
series were also cancelled. Notification delivery to the organizer is unproven.
No addresses, tokens or raw mailbox resources are committed.

## Verification

- Fake Graph HTTP: all responses, moved exceptions, creation timestamps, parent
  states, unrelated changes, permanent dispatch marker and no-resend recovery.
- PostgreSQL: one-off and recurring matrices, hidden capability and no intent for
  an unanswered parent, parent becoming unanswered after admission, mapping and
  lease races, sync echoes, disappearance and retained private evidence.
- Existing web/native and six Chromium light/dark desktop/narrow scenarios
  passed before these server-only refinements. Initial GitHub CI passed 20/20;
  final commit checks remain pending.

## Boundaries

Whole-series replies, unanswered-series initialization, canonical local-series
children, delegated calendars and general all-day representations are not added.
No production activation, schema migration, release or deployment. Graph's
separate reads and response action do not provide an atomic revision condition.

[Redacted results](evidence/outlook-occurrence-rsvp-20260923.json) ·
[Contract](../sync/microsoft-rsvp.md) ·
[Microsoft response action](https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept?view=graph-rest-1.0)

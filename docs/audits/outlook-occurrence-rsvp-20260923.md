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
difference; the final live pass below verifies the corrected path.

All three actions used exactly one POST despite a subsequent read-only check.
The disposable series were cancelled at the Google organizer and cancellation
was read back; isolated local fixture rows were removed. Two earlier harness
attempts ended early (receipt ID lookup and a strict parent assertion); their
series were also cancelled. Notification delivery to the organizer is unproven.
No addresses, tokens or raw mailbox resources are committed.

## Final live pass

The corrected code rejected the native unanswered parent. After an expressly
approved native whole-series Tentative response used only to prepare the test
fixture, the **actual Musubi queue/outbox** completed:

- Accept on the first occurrence: `completed`, own response `accepted`, one POST.
- Tentative on that now-existing exception: `completed`, own response
  `tentativelyAccepted`, one POST, creation timestamp preserved.
- Decline on the occurrence after the DST transition: target 404 and
  `unconfirmed / graph-rsvp-copy-absent`. A read-only recheck sent no second POST.

Each step preserved the parent response, authored fields, neighbouring slots and
unrelated exceptions. Expanded master bookkeeping changed only for the selected
exception/cancellation, with the cancelled occurrence ID checked exactly. The
series was cancelled at Google, Outlook readback confirmed `isCancelled=true`,
and the isolated database contained zero remaining test users. This setup does
not add a whole-series response capability to Musubi or prove mail delivery.

## Verification

- Fake Graph HTTP: all responses, moved exceptions, creation timestamps, parent
  states, unrelated changes, permanent dispatch marker and no-resend recovery.
- PostgreSQL: one-off and recurring matrices, hidden capability and no intent for
  an unanswered parent, parent becoming unanswered after admission, mapping and
  lease races, sync echoes, disappearance and retained private evidence.
- Existing web/native and six Chromium light/dark desktop/narrow scenarios
  passed, including keyboard/focus, axe and overflow checks. GitHub CI passed
  all 20 checks on code commit `d3ad8ef`, including all DB/web shards, native/web
  tests, typechecks, image builds and production-container smoke checks.

## Boundaries

Whole-series replies, unanswered-series initialization, canonical local-series
children, delegated calendars and general all-day representations are not added.
No production activation, schema migration, release or deployment. Graph's
separate reads and response action do not provide an atomic revision condition.

[Redacted results](evidence/outlook-occurrence-rsvp-20260923.json) ·
[Contract](../sync/microsoft-rsvp.md) ·
[Microsoft response action](https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept?view=graph-rest-1.0)

# Outlook occurrence time zones — 2026-09-22

Extends the UTC occurrence-time contract from PR #317 to **Europe/Prague**.
The web and native editor use the verified series zone, including for moved
exceptions whose stored time model is unknown. The zone remains fixed.

## Proof and admission

- Only a fully observed finite family in the account's own default calendar
  qualifies. Existing ownership, scope, revision, ETag and family fences remain.
- For provider-expanded rows, the organizer reader accepts the known Windows
  recurrence alias `Central Europe Standard Time` only with BOTH explicit native
  original-zone labels equal to `Europe/Prague`. It then checks the complete
  generated footprint against native original slots, including DST offsets.
  This is a temporary comparison template, not adoption of a canonical family.
  The generic unbound creation/recovery time parser remains strict.
- The named zone must appear in the mailbox's IANA supported-time-zone response;
  checked on observation/admission and again before first dispatch.
- Requests must retain the proven series zone. Both endpoints reject ambiguous
  autumn clock folds and missing spring clock times. Neighbouring-day bounds
  use the series zone, including cancelled and moved neighbours, not UTC dates.
- `outlookOrganizer=6` opts into `organizerEdit.timeZone`. Earlier opt-ins never
  receive that field; v5 keeps UTC time editing only. New clients fall back to
  UTC when an older occurrence-time capability has no zone field.
- One conditional PATCH, exact native UTC readback, durable acceptance and no
  resend after uncertain dispatch remain unchanged. Seven-digit native UTC
  timestamps are normalized only when sub-millisecond digits are zero.

## Meeting response reset

Live probes found Outlook resetting a seeded accepted response to
`notResponded` / `4501-01-01T00:00:00Z` when changing the selected occurrence's
start/end. A UTC control did the same; the prior PR's probe had preserved the
response. Thus preservation is not a reliable invariant for a time change.
Microsoft documents date/time changes as full meeting updates requiring a new
response: [full versus informational updates](https://learn.microsoft.com/en-us/office/client-developer/outlook/auxiliary/about-meeting-requests-as-informational-updates-and-full-updates).

Readback now accepts either exact prior responses or this narrowly verified
empty-response reset **only when the selected occurrence actually changes time**.
Guest identities, names, roles, extra fields, master and siblings stay exact.
A new reply, different response timestamp, added/removed guest or role change
remains unconfirmed. The actual observed response is stored locally; no request
rewrites attendees and no extra invitation is sent by Musubi. The existing
invitation-information tooltip explains that guests may need to respond again.

## Validation

- Native personal and organizer-meeting Prague series spanning the autumn DST
  transition: move, restore, stale ETag rejection (412), neighbour crossing
  rejection (400), unchanged original slot, HTML and siblings.
- Two consecutive **actual Musubi queue/outbox** edits each for personal and
  meeting Prague series. Exact requested local/native instants, stored Prague
  intent and observed RSVP, unchanged HTML/guest list/siblings. Native fixture
  removal verified with 404; all corresponding local test rows removed.
- DB tests: flat/canonical Prague families, spring/autumn offsets, gap/fold
  refusal, local-midnight acceptance, local-day crossing refusal, wrong zone,
  unsupported mailbox zone, correct RSVP reset and refusal of altered role or
  reply timestamp. Existing UTC race, loss, recovery and flag tests retained.
- Prior occurrence, series and one-off meeting content integration suites pass.
- Shared draft/schema and native time parser tests; web/native editor and detail
  tests; API/web/native type checks and scoped web lint.
- Chromium: light desktop and dark narrow layout, Prague draft/submitted zone,
  keyboard/focus return, axe, overflow/layer checks and identical frozen retry.

Redacted native and application results are in
[evidence](./evidence/outlook-occurrence-zones-20260922.json). Seeded RSVP fixtures
verify provider state handling, not real recipient acceptance or mail delivery.

## Remaining boundaries

Only UTC and Europe/Prague are enabled by this contract. Arbitrary Windows/IANA
mapping, zone conversion, all-day time changes, whole-series time/recurrence
changes, attachments and online-meeting write shapes remain outside it. Existing
family reads are not atomic across Graph resources; a concurrent unrelated
change still prevents successful completion. No schema migration, dependency,
production flag, release or deployment change.

References: [Graph event update](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0),
[supported mailbox time zones](https://learn.microsoft.com/en-us/graph/api/outlookuser-supportedtimezones?view=graph-rest-1.0).

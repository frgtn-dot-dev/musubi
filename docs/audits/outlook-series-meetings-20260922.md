# Outlook recurrence deletion and meeting cancellation — 2026-09-22

## Result

The first implementation supports deleting one occurrence or an entire tracked
personal Outlook series, and cancelling an organizer-owned one-off meeting in the
owned default calendar. The user explicitly approved the guarded preflight model
for these operations after the probe demonstrated that Graph ignores stale
`If-Match` on DELETE and `/cancel`. Fresh reads reduce the race; they do not make
these writes atomic. The generic personal writer remains separate and continues
to reject meetings and recurrence.

No production deployment or feature-flag change is included. Personal series
use the existing `EVENT_TIME_EDITS_ENABLED` gate; meeting cancellation uses
`PROVIDER_ORGANIZER_EDITS_ENABLED`.

The connected personal Microsoft mailbox was used for two new personal daily
COUNT=3 series (UTC timed and all-day), plus two new organizer meetings (one-off
and daily COUNT=3). The user explicitly authorized their own test recipient for
invitations and cancellations. Personal series used a new disposable calendar;
meetings used new IDs in the owned default calendar. Existing events were never
mutation targets. The test calendar was removed and the organizer meeting copies
were confirmed absent after cancellation. Guest-side mail delivery was **not**
independently verified.

[Redacted live evidence](evidence/outlook-series-meetings-20260922.json) records
statuses, request IDs and boolean observations, without tokens, guest addresses,
native event content or mailbox IDs. `completed: true` means the probe finished;
it does not assert conditional deletion or production readiness.

## Observations

| Operation | Observed native behavior | Meaning for Musubi |
| --- | --- | --- |
| Personal occurrence title PATCH | Current native version returned 200 and created an exception; stale version returned 412 without changing its title | A provider-aware single-occurrence edit is a viable first implementation |
| Child edit vs master version | Master version changed in both tested series; PATCH with its prior version returned 412 | Useful evidence for these cases, not proof that every descendant change advances the master or that a family read is atomic |
| Master location PATCH | Fresh version returned 200; the subsequent stale subject PATCH returned 412 | Bounded master-write evidence, not acceptance of recurrence-rule changes or time edits |
| Personal occurrence DELETE | Stale condition returned 204; exact instance GET returned 404; both other instances remained | Requires explicit acceptance of the same non-atomic preflight compromise as one-off deletion, plus exact master/original-slot binding |
| Personal master DELETE | Stale condition returned 204; master and remaining children returned 404 | Whole-family deletion needs family evidence and atomic local family persistence; generic single-event deletion is insufficient |
| One-off organizer title PATCH | Fresh version returned 200; stale version returned 412 and retained the accepted title | Must use an explicit meeting-update flow with notification semantics |
| Recurring organizer occurrence title PATCH | Fresh version returned 200; stale version returned 412 | Must bind the exact occurrence and retain organizer/guest identity |
| One-off and occurrence cancellation | `POST /cancel` with a stale version returned 202; target copy disappeared; other recurring instances remained | Cancel does **not** establish CAS. It needs a durable possible-dispatch marker and read-only recovery, not automatic resend |
| Remaining meeting series cancellation | Normal cancel returned 202 and the master returned 404 | Cleanup succeeded on the organizer side; this does not prove delivery to the guest |

The exception-title observation in the report follows the master PATCH attempt
that returned 412. It is not evidence that an accepted whole-series title edit
preserves exception content. Successful whole-series content changes, recurrence
rule changes, named-zone time changes, attachments, conferencing and richer
guest behavior need their own tests.

## Implementation and limits

- **Personal series:** the existing complete finite-family reader proves the
  root, every active occurrence, moved exceptions and cancelled slots. Admission
  compares this with the accepted local family; dispatch rechecks native versions,
  exact target binding, ownership and current write permission. One immutable
  operation records the scope and native baseline. The local family and delivery
  receipt complete atomically. Pending intent fences generic sync and generic
  conflict resend. A lost response can only be reconciled by a complete read;
  it cannot cause another DELETE.
- **Meetings:** only supported one-off organizer copies with complete guest
  evidence are advertised. The existing verified account/default-calendar
  identity, local revision, provider version and private baseline all participate
  in admission and dispatch. `/cancel` is explicit and has a permanent dispatch
  marker. Completion requires recorded HTTP 202 acceptance and confirmed absence.
  Absence alone after a lost response cannot prove notification acceptance and
  stays unresolved. Guest-side mail delivery is always reported as unknown.
- **Clients:** web and native reuse their existing confirmation/editor patterns,
  with Outlook-specific wording and a delete-only capability. New clients request
  `provider-state?outlookOrganizer=1`; old clients and federated reads never receive
  the added Microsoft organizer provider enum. Existing strict wire snapshots pass.
- **Unsupported scope:** personal families must already be tracked canonically
  and fit the existing complete-reader bounds (at most 366 occurrences and 730
  days). Legacy expanded-only/unbounded series, recurring meetings, conferencing,
  delegate/shared organizer copies, recurrence edits and “this and following”
  remain unsupported. One-off cancellation does not expose meeting content/time
  editing. Unsupported operations must not fall through to the personal writer.
- **Recovery:** conflicts and genuinely ambiguous outcomes retain their durable
  evidence; generic rebase/resend is deliberately unavailable for these private
  operations. Read-only retries can confirm a matching deleted personal family
  or a meeting cancellation with previously recorded acceptance. They do not
  silently turn a changed remote item into a new destructive intent.

## Implementation validation

[Redacted implementation evidence](evidence/outlook-deletion-implementation-20260922.json)
records an actual application DB/outbox/Graph run, separately from the earlier
raw HTTP probe. Two new personal daily COUNT=3 series (timed and all-day) each
completed an occurrence deletion followed by deletion of the remaining series.
The disposable calendar was then removed. A new one-off meeting was created for
the explicitly authorized test recipient, cancelled through the application
organizer queue/worker, confirmed absent, and removed from the local QA database.

The provider advanced versions shortly after creation. Initial stale attempts
were rejected before destructive dispatch. The successful personal run allowed
creation to settle before importing its baseline. The meeting's first cancellation
admission was also rejected; a fresh normal projection was imported and a **new**
explicit intent completed. No validator was relaxed to make the live test pass.
No guest-side mail-delivery claim follows from these observations.

Offline DB coverage includes exact replay, moved exceptions, all-day series,
stale admission and dispatch, sibling changes, local commit races, permission
and identity loss, incomplete guests, forbidden recurring meetings, lost replies,
crash markers and acceptance recovery without duplicate requests. Regression
checks cover the existing Graph family, Google/CalDAV scopes, Microsoft creation
and one-off deletion paths. Targeted web/native component tests, type checks and
contract checks pass. Browser checks cover desktop/mobile confirmation, safe
initial focus, keyboard activation and focus return, lost-response retry identity,
accessibility, and light/dark themes.

## Reproduction and offline checks

`scripts/probe-outlook-series-meetings.mjs --live` requires `OUTLOOK_CAS_TOKEN`
in the environment. It defaults to attendee-free personal series. Meeting mode
additionally requires an explicitly authorized `OUTLOOK_QA_GUEST` and
`--allow-invitations`; it sends real invitations, updates and cancellations.
Do not pass tokens on the command line or reuse the live run as routine CI.

`node --test scripts/probe-outlook-series-meetings.test.mjs` uses a fake provider
to verify probe safety and result interpretation: both parent-version behaviors,
no network before invitation authorization, no repeat after an ambiguous cancel
or create, explicit incomplete-cleanup reporting, foreign-family refusal, scoped
test-only mutations and redaction. These mocks are not evidence of Graph behavior.

## Primary sources

- [Update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0): omitted-field behavior, meeting updates and recurrence exception constraints. Online-meeting body updates must retain conferencing data.
- [Cancel event](https://learn.microsoft.com/en-us/graph/api/event-cancel?view=graph-rest-1.0): organizer-only action, occurrence ID support, cancellation message and asynchronous 202 response.
- [Delete event](https://learn.microsoft.com/en-us/graph/api/event-delete?view=graph-rest-1.0): normal deletion and organizer meeting cancellation side effects.
- [List instances](https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0): bounded instance retrieval; a single date window is not an atomic family snapshot.

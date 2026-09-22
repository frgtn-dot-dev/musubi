# Outlook recurrence and meeting investigation — 2026-09-22

## Result

Bounded live tests confirm that personal recurrence and organizer meeting writes
are feasible, but they need separate scope and notification contracts. Do not
remove the `singleInstance`/attendee guards from the generic personal-event
writer. No application capability, feature flag or production behavior is
enabled by this investigation.

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

## Existing implementation and required changes

1. **Personal single occurrence.** Existing import retains native master IDs and
   original starts; tracked finite families also have stable canonical child
   identities. Add a Graph-aware scope operation that proves the mapping,
   original slot, exact native child and current permissions before admission
   and dispatch. Keep the accepted version for PATCH, and reconcile native
   cancellation into the canonical occurrence without regenerating it on sync.
   Relevant boundaries: `event-scope.ts`, Graph family queries, adapter scope
   evidence and the durable delivery worker.
2. **Personal whole series.** Reuse the complete family reader, including moved
   exceptions and cancellations, rather than treating a calendarView window as
   the family. Store and recheck the accepted family observation. Deletion must
   tombstone the root and children coherently and retain delivery/conflict
   evidence. An unchanged master version alone is not a whole-family guarantee.
3. **Organizer one-off meeting updates and cancellation.** The current Microsoft
   organizer request, capability and transport are create-only. Extend that
   explicit contract, reusing verified account/default-calendar identity, private
   guest baseline, immutable journal and permanent possible-dispatch marker.
   Cancellation uses the organizer-only `/cancel` action. Confirmation must say
   that guests will be notified; a guest's decline/removal is a different action.
   Current generic personal-event delete must continue rejecting meetings.
4. **Recurring meetings.** Compose the verified occurrence/family scope with the
   organizer contract, then test invitation/update/cancellation on the guest's
   calendar as well. Do not infer these semantics from personal series alone.
5. **This and following.** Treat truncation and replacement as separately
   journaled operations with partial-outcome recovery. This probe does not test
   or authorize a naive split, bulk recreation or duplicate invitations.

First release candidates should be narrowly defined (personal occurrence and
whole-series deletion, followed by one-off organizer cancellation). The owner
previously accepted the remaining race **only for personal one-off events**.
The larger scope and notification side effects need an explicit product decision
before enabling these new deletion/cancellation paths.

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

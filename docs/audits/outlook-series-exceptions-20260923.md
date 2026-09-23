# Outlook series exceptions and cancellations — 2026-09-23

## Decision

Keep whole-series time editing unavailable when a family contains changed or
cancelled occurrences. This investigation did not find a single supported master
write that preserves them. It **does not enable a new production writer**.
The existing content-only series editor and supported individual-occurrence time
editor remain the available paths.

This follows the [plain-series time work](outlook-series-time-20260922.md) and
[end-date cutoff support](outlook-series-until-20260922.md). The distinction is
loss of independent occurrence state, not whether recurrence uses COUNT or UNTIL.

## Live findings

[Redacted evidence](evidence/outlook-series-exceptions-20260923.json) covers new
personal and organizer meeting fixtures in one owner's default calendar. Each
series has five UTC occurrences three days apart. Depending on the scenario,
we independently change one occurrence's title/HTML notes/location, move another,
and cancel a third. Only the previously authorized test recipient was invited.

| Operation | Personal series | Organizer meeting |
| --- | --- | --- |
| Change master clock with two exceptions | Exceptions disappear; independent content is lost | Same; RSVP resets |
| Change master clock with one cancellation | Cancelled occurrence returns | Same; RSVP resets |
| Change only master end/duration with both | Exceptions disappear and cancellation is undone | Same; RSVP resets |
| Change clock and resend the identical native recurrence | Same loss despite unchanged recurrence | Same loss; RSVP resets |
| After master change, rewrite both exceptions and cancel the revived slot | Content, times, IDs/UIDs and cancellation reconstructed | Content, times, IDs/UIDs and cancellation reconstructed; old exception RSVP states are **not** preserved |
| Edit ordinary occurrences separately, with a concurrent change before the second | First PATCH succeeds, second returns 412; first remains changed | Same; original exceptions and cancellation survive |

The reconstruction experiment uses three additional writes after the destructive
master PATCH. It proves that reconstruction can succeed in a controlled fixture,
not that it is a safe transparent update. There is a visible interval with revived
or reset occurrences; any later write may fail or lose its response. Invisible
field-inheritance flags and arbitrary exception metadata are not covered. The
meeting experiment also loses the previous RSVP state. Original IDs returning
in these fixtures must not be generalized into a provider guarantee.

Individual writes preserve the original exceptions and cancellations, but leave
the master clock unchanged and turn edited ordinary occurrences into exceptions.
The live concurrent-edit experiment proves an observable partial result: HTTP 200
for the first occurrence and HTTP 412 for the second. This is a different product
action from editing the recurring master. Graph batching does not supply an
all-or-nothing rollback contract for this sequence.

## Recommended next product action

If bulk time changes are needed, implement a separate **Move selected occurrences**
action with an explicit finite preview. Default to ordinary active occurrences;
keep individually moved/edited occurrences and cancellations unchanged. Display
the exact affected dates/count and explain that the series rule stays unchanged.

It needs a durable per-occurrence operation journal, fresh identity/version checks
at each step, no resending an uncertain accepted write, and visible completed,
failed and unconfirmed results. Resume must operate only on resolved pending
items, and re-review intervening changes. A partial result must never appear as a
successful whole-series save. Meeting notification/RSVP consequences belong in
that review. This is a proposed follow-up, not implemented or enabled here.

Do not add a hidden master-PATCH-and-repair fallback to the existing editor.
That would silently weaken its contract and briefly resurrect cancelled meetings.

## Regression coverage and reproducibility

- `scripts/probe-outlook-series-exceptions.mjs` is a diagnostic function requiring
  an explicit token, optional authorized guest and bounded scenario selection.
  It targets only IDs returned for fixtures created in the same run. Private
  checkpoint callbacks support cleanup without exposing identities in evidence.
  It never retries uncertain cleanup writes.
- Its offline transport tests run in `pnpm test` and cover fixture-only mutations,
  invitation authorization, foreign-family rejection, partial writes, reconstruction
  limitations, credential redaction and uncertain cleanup handling.
- The real admission/outbox integration suite also checks duration-only requests
  on exception/cancelled families and a new cancellation after admission, for
  COUNT and UNTIL. No PATCH is sent in these cases. Existing 60 cases are retained.
- The first individual-write probe captured stale sibling versions; the next
  revision omitted `originalStart` in a direct GET and sent an invalid date. The
  final script explicitly requests it and demonstrates 200/412. All intermediate
  fixtures were cleaned. Evidence retains these attempts rather than presenting
  them as successful partial-update tests.
- All 16 new native fixtures were removed: personal DELETE 204 or meeting cancel
  202, followed by GET 404. No application event rows were created. Guest response
  values were seeded; actual acceptance or notification receipt is not asserted.

No UI/API/schema/capability or production behavior changes, no dependency,
feature-flag change, release, tag or deployment.

## Sources and limits

Microsoft's [update event API](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0)
allows omitted properties to be recalculated as a consequence of an update and
notes notification fan-out for a series with separately updated instances. It
does not document a preservation option for this master time change. The concrete
reset and reconstruction results above are live observations from this account.

[JSON batching](https://learn.microsoft.com/en-us/graph/json-batching) gives each
request its own status, and dependencies prevent downstream requests after a
failure. It provides no rollback of earlier successful requests. Batching alone
is therefore insufficient to hide partial results here.

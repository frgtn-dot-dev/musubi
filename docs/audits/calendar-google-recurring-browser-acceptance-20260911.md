# Google bound recurring meeting browser acceptance — 2026-09-11

## Scope and setup

This follow-up closes the fresh Musubi browser-admission gap in the earlier
[backend/native Google acceptance](calendar-google-recurring-live-acceptance-20260911.md).
The tested checkout was based on `b786a2308be9b1548a2377bf52ef3dacb69eaa23`.
The owner authorized the two connected Google QA accounts, test invitations,
notification requests between them, and subsequent cleanup.

Two native DAILY COUNT=3 series covered September 24–26 in Europe/Prague:
inbound at 14:00–14:30 and outbound at 15:00–15:30. Each September 25 occurrence
was renamed natively before import, producing a stored child with a native
parent and original-slot binding. Native setup is not Musubi recurring-create
acceptance. The inbound native attendee list included the organizer plus the
sole invited other account; outbound contained the sole invited other account.

The local web UI ran at port 3000 against the isolated QA API/database, with
RSVP and organizer capabilities enabled for development. Scheduled sync was
disabled. Every new intent was admitted through the real Musubi form; a bounded
helper invoked the standard delivery worker for the exact existing UI receipt.
It did not queue replacement intents. Native family baselines were frozen
privately before the first browser action. No credentials, real account
addresses, provider IDs or raw event bodies are published here.

## Attendee flow

The detail identified the selected occurrence and exposed **Respond to this
occurrence**. The form explained occurrence scope and requested Google
notifications without claiming verified email delivery. Accept, Tentative and
Decline were submitted separately. Saved-request feedback explicitly said
Google confirmation was pending; the completed receipt was checked separately.

All three UI-created operations completed. Fresh Google Calendar views on the
organizer account independently showed the attendee participating, tentative,
and not participating; the counts were two Yes, one Yes/one Maybe, and one
Yes/one No. Musubi's reopened detail reported accepted, tentative and declined.
A neighboring native occurrence still showed an unanswered guest.

The first Tentative attempt after helper delivery was rejected as a stale remote
version, with **No changes were saved** and no new pending receipt. Closing the
form, using **Connections → Refresh connected calendars**, and reopening it
allowed a fresh request to complete. This confirms safe rejection and explicit
recovery, not seamless background refresh: helper delivery ran in a separate
process and did not deliver the API process's in-memory SSE notifications.
Later distinct actions used the explicit refresh path.

## Organizer flow

**Manage this occurrence** exposed title, notes and location, stated that timing
and guests remained unchanged, and made guest notification explicit. The saved
UI update changed all three content fields. The standard worker completed the
exact receipt. A fresh guest Google Calendar detail displayed the updated title,
notes and location at the original 15:00–15:30 time. Musubi displayed the changed
content and a receipt saying the action was observed in Google while notification
delivery remained unverified.

**Cancel this occurrence and notify guests** opened a separate confirmation
that explicitly applied only to this occurrence. The confirmed UI request
completed through the worker. Native readback showed the target cancelled;
a fresh guest month view omitted that target and retained both siblings.
Musubi's refreshed month likewise omitted it. Neither new family appeared in
Unfinished deliveries after completion; older unrelated QA entries were left
untouched. This is not evidence that a completed deleted receipt is directly
reachable from that unfinished-only list.

## Preservation and cleanup

After each of the five completed operations, native comparison confirmed the
master and both siblings unchanged in the compared fields: identity, original
slot, status, content, start/end, recurrence, organizer and attendees. RSVP
allowed only the target's own response to differ; organizer update allowed only
target content to differ. Cancellation verified target cancellation separately.
ETags and bookkeeping timestamps were excluded. Reminders, conference data,
visibility/transparency and other unexamined fields are not covered by these
preservation assertions.

Both finite series were subsequently cancelled in their organizer accounts:
inbound through native Google UI, outbound through one guarded conditional
native DELETE with notifications requested for the sole test guest. Cleanup is
not Musubi whole-series writer acceptance. Final read-only checks on the main
account found both masters and all six known instances cancelled. Standard sync
left zero active rows and two local tombstones per family. All five frozen UI
operation receipts remained completed. Private attempt journals prevent blind
repetition of uncertain cleanup writes.

## Limits

This accepts the tested known-zoned stored occurrence browser flows. It does not
certify all-day meeting variants, generated meeting occurrences, whole-series or
following writes, guest edits, delegation, lost-response recovery, physical
native clients, OS notifications, exactly-once email delivery or production
activation. Existing fake HTTP/database tests remain separate evidence.

The local browser returned to sign-in during final cleanup verification, after
the five actions had completed. Standard Google sign-in was renewed with the
already approved scopes. The restored Musubi month and fresh Google month both
showed no events from these fixtures. The cause of the sign-in transition was
not established by the calendar checks; cleanup proof and session behavior are
separate results.


## Session-check regression discovered during follow-up

The first observed failure was an API 401 followed by an auth check; local logs
do not establish why that session became unavailable. No short session lifetime
was configured. A separate code review found that a resolved Better Auth
`getSession()` error with null data could trigger `signOutAndReset`, clearing
local state even when the check had merely failed.

The gate now retains local state for non-401 check errors, while a successful
empty response or explicit 401 still confirms sign-out. A valid session still
refetches. Eight targeted regressions cover resolved transport/rate-limit/server
errors, rejected fetch, confirmed absence and a valid session. This fixes the
identified failure path without claiming it caused the live sign-in transition.


The isolated Chromium regression also passed both real-client flows with mocked
HTTP: an event-save 401 followed by a session-check 503 retained the draft and
local session marker and allowed a later save; successful null session
confirmation signed out and removed the marker. Running the 503 scenario with
the old gate logic failed on the unexpected sign-out, confirming the regression
catches the original bug. This browser test did not contact the live QA provider.

Validation for this batch: 612 web unit tests, web typecheck and lint, the two
Chromium session scenarios, documentation build, and independent review passed.
Exact-head CI and merge are recorded in the associated PR.

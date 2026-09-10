# Outlook one-off invitations — live acceptance, 2026-09-10

## Scope

The owner authorized two synthetic meetings between their connected Outlook
mailbox and their Google mailbox, both on September 11, 2026, 16:00–17:00
Europe/Prague (14:00–15:00 UTC), including responses and cleanup notifications.
Credentials remained in the private local development configuration. Production
flags and compatibility minima were unchanged. The automatic scheduler stayed
disabled; exact-title pending QA operations used the standard delivery worker.

## Organizer create and recipient response

Musubi's primary-calendar **Create Outlook meeting** flow created
`Musubi QA Outlook outbound 0911` with the single authorized Google guest and
the exact one-hour UTC interval. The standard worker completed the operation.
Native Outlook and the guest's Google Calendar independently displayed the
correct title and 16:00–17:00 interval. After the guest accepted in Google,
Outlook's organizer detail explicitly showed that guest as having accepted.

Cleanup used Outlook's native cancel-and-notify flow because Musubi does not
claim Graph organizer UPDATE/DELETE support. The meeting disappeared from the
native Outlook calendar and the Google guest calendar. Its local mirror initially
remained: the current incremental delta contained no tombstone, while direct GET
returned 404 and a fresh full snapshot excluded the event. A guarded cursor reset
for this source followed by standard full sync removed the local mirror. The
reason the incremental tombstone was missed could not be established from the
remaining cursor; this recovery does not certify incremental cancellation.
This is observed invitation/response propagation, not exactly-once email proof.

## Inbound RSVP

Google created `Musubi QA Outlook inbound 0911` for the same interval, inviting
only the authorized Outlook mailbox. Google's final external-organization guest
confirmation had to be completed before the invitation was actually saved.
The native Outlook calendar then showed the tentative copy, and standard sync
imported it into Musubi with the external organizer and `notResponded` state.
Initially Musubi did not expose **Respond in Outlook**: the native ETag had
changed after import. A subsequent ordinary delta contained the new version;
standard sync and reopening restored the action without changing any guards.
**Accept** was submitted through Musubi and the standard worker. The Google
organizer then displayed two Yes responses, including the Outlook attendee.
The durable Musubi result remained `unconfirmed`: Graph changed availability
from `tentative` to `busy`, and left the self attendee status at `none` while
the native own `responseStatus` became `accepted`. No automatic resend was
attempted. After the bounded readback correction, a live **Check response**
passed the native comparison but still could not ACK an earlier retained sync
snapshot. That snapshot contained the same current identity/version/state but
had been classified as a non-echo under the previous comparison. The bounded
pull-before-ACK fix was tested and independently reviewed. The next live
**Check response** completed the original operation and the UI displayed
**Response observed in Outlook**. The original dispatch marker was preserved;
no response was resent and history was not rewritten.

After standard sync, **Tentative** was submitted from Musubi. The organizer's
Google Calendar showed one Yes and one Maybe, explicitly identifying the Outlook
attendee as tentative. Native readback showed only the corresponding own response
and `showAs: busy → tentative` plus validator/timestamp changes; the self attendee
still remained `none`. After the exact transition was added and tested, live
**Check response** completed the original Tentative operation without resending.

**Decline** was then submitted through the same Musubi flow. Graph accepted the
action and its copy became unavailable (GET 404). Musubi displayed **Outlook
meeting copy unavailable**, with **Check response** and explicit no-resend wording.
Read-only checking retained that honest result. Fresh Google organizer views
still showed the previous Maybe response several minutes later. Thus decline
delivery is **not accepted as proven**; absence is not evidence of success.

The organizer subsequently deleted the synthetic meeting through Google's
cancel-and-notify flow. Both native calendars no longer displayed either QA
meeting. Standard Google and Outlook sync completed. Musubi retained the inbound
local copy and its uncertain Decline history; that preserved pending record is
not claimed as a fully cleaned or confirmed operation. Accept and Tentative
records remained completed. The unrelated old Google uncertain record was left
unchanged.

## Import regression found during the run

An unrelated recurring item caused Outlook sync to fail because Graph omitted
`originalStart` in both the delta item and an ordinary instance GET. Explicit
`$select=*,originalStart` hydration returned the native UTC identity while
retaining the default fields. The adapter now requests that projection;
identity, series, cancellation and exact-precision checks remain unchanged.

The regression covers omitted delta identity, explicit hydration and refusal
without event/cursor changes if identity is still missing. Targeted adapter,
time and disposable PostgreSQL occurrence tests passed. Read-only live adapter
checks passed all three calendars, followed by successful standard live sync.
Independent clean-context review found no actionable issues in the final fixes.
The full `pnpm check` passed with test configuration and an isolated disposable
database. RSVP fake-HTTP and PostgreSQL regressions include lost-response public
recovery, pull-before-ACK, actual observed state, unrelated-field refusal and no
second POST. The [delta reconciliation regression](calendar-outlook-delta-reconciliation.md)
also verifies safe full-reset removal and pending-operation protection.

## Limits

Outlook organizer create and attendee Accept/Tentative have bounded live evidence.
Decline organizer delivery and automatic repair of an ACK-created mirror missing
from delta remain open; the latter has a verified manual full-sync recovery.
Recurring creation, delegated operations, native conditional UPDATE/DELETE,
physical-device notifications and production activation are not certified by
this run. Existing unrelated uncertain Google operation history is preserved.

## Follow-up: fresh direct Decline and stopped receipt — 2026-09-10

Two new single meetings on September 17 were sent from the same authorized
Google organizer to the sole Outlook QA attendee through native Google UI.
The first (`Musubi QA Outlook decline direct 0917`, 15:00 Prague) was imported
by standard sync and Decline was saved in the Musubi browser. The normal worker
stopped with `provider-conflict` before dispatch: neither dispatch marker was
present, and no RSVP POST was sent. Read-only comparison showed changed native
`changeKey`, `@odata.etag` and `lastModifiedDateTime`, with response still
`notResponded`. The original saved operation was not rewritten or retried.

This exposed misleading receipt wording: a stopped, never-dispatched response
was still described as waiting to be sent. The shared receipt now says
**Outlook response not sent** and explains that the saved response is stopped.
The corrected wording was verified in the live Musubi Delivery dialog. There is
currently no in-app discard/reprepare action for this Graph conflict; the
receipt directs the user to the current meeting in Outlook. This change does
not relax the native snapshot check or add an automatic retry.

The second (`Musubi QA Outlook decline stable 0917`, 16:00 Prague) was imported
and refreshed before a fresh Musubi Decline. At 15:04 UTC the exact normal
worker made one accepted dispatch, then reported `graph-rsvp-copy-absent`: both
started/accepted markers exist, attempts = 1, status = `unconfirmed`. The browser
showed **Outlook meeting copy unavailable** with **Check response** and explicit
no-resend wording. Fresh Google organizer views continued to show the attendee
as not responded. Organizer delivery remains **unproven**; accepted dispatch
and a missing copy are not a successful-delivery assertion.

Both meetings were deleted through native Google cancel-and-notify. The first
meeting’s cancellation notice was sent after the owner explicitly confirmed
that final cleanup action. Both local journals are intentionally preserved;
full local cleanup is not claimed.

The new shared receipt tests, CalDAV scheduling regressions, API typecheck and
full `pnpm check` passed. Independent clean-context review was clean after the
empty-href discovery regression was fixed. Exact-head CI remains the PR gate.

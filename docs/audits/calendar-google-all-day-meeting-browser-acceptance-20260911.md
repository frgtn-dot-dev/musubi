# Google all-day bound meeting browser acceptance — 2026-09-11

## Scope and setup

This follows the [known-zoned browser acceptance](calendar-google-recurring-browser-acceptance-20260911.md)
with two fresh all-day DAILY COUNT=3 series on September 28–30. The checkout was
based on `43b762048c1f4049045b77cadfd69f12449e6195`. The owner authorized the two
Google QA accounts, invitations and notification requests between them, and
cleanup. No real addresses, credentials, provider IDs or raw event bodies are
published here.

Each series had one stored September 29 child, renamed natively before import
and bound to its native parent and original DATE slot. The master started
September 28 with exclusive end September 29; each occurrence occupied one
calendar date, including September 30 → October 1. Native DATE values remained
DATE values, without a dateTime conversion. Native fixture setup is not Musubi
recurring-create acceptance.

The local web UI used the isolated QA API/database with development RSVP and
organizer capabilities. Scheduled sync remained disabled. Every tested action
was admitted through the actual Musubi form. A bounded helper delivered only
the exact existing UI receipt through the standard worker; it never admitted
a replacement operation. Private native baselines preceded browser actions.

## Results

| Browser action on the stored child | Completed receipt and native observation | Independent Google browser observation |
| --- | --- | --- |
| Accept | Own response accepted | Organizer saw two Yes |
| Tentative | Own response tentative | Organizer saw one Yes, one Maybe |
| Decline | Own response declined | Organizer saw one Yes, one No |
| Organizer content update | Requested title, notes and location observed | Guest detail displayed all three changes on September 29, still all-day |
| Organizer cancellation | Target cancelled, master and siblings preserved | Guest month omitted September 29 target and retained September 28 and 30 siblings |

Musubi's reopened detail showed the three responses. The day view exposed both
all-day fixtures and opened the organizer's stored child. **Manage this
occurrence** stated that timing and guests remained unchanged. The update's
Delivery panel reported the action observed in Google, while correctly retaining
the limitation that guest notification delivery cannot be verified.

**Cancel this occurrence and notify guests** required its separate occurrence
confirmation. The completed operation removed that target from Musubi's day
view. Native provider readback and the guest's fresh Google Calendar view
confirmed cancellation independently of the initial saved-request feedback.

The first Tentative attempt after separate-process helper delivery was safely
rejected as stale, without a new pending receipt. **Connections → Refresh
connected calendars** and a fresh form allowed the request to complete. This
tests explicit recovery; it does not certify seamless SSE refresh across helper
processes. Early browser sign-in interruptions were investigated separately;
the [development cookie isolation report](calendar-dev-cookie-isolation-20260911.md)
records the evidence and bounded fix. Normal OAuth sign-in was used to resume.

## Preservation and cleanup

After each completed operation, comparison against the frozen native baseline
confirmed unchanged master and siblings in identity, original slot, status,
content, start/end, recurrence, organizer and attendees. RSVP permitted only the
target's own response to differ. Organizer update permitted only target content
to differ. Cancellation separately verified that the target was cancelled.
ETags and bookkeeping timestamps were excluded. These assertions do not cover
reminders, conference data, visibility/transparency or other unexamined fields.

Both finite test series were then cancelled by their organizers: inbound through
native Google UI and outbound through one guarded conditional native DELETE,
with notification requested for the sole authorized guest. This cleanup is not
Musubi whole-series writer acceptance.

Final verification found **8/8 known native resources cancelled**, **zero active
local rows**, **two retained tombstones per family**, and **5/5 completed UI
receipts** after standard sync. The final proof made no provider event writes,
admission calls or delivery calls. Fresh Google month and Musubi day views
contained no events from these fixtures.

## Limits

Together with the earlier zoned run, this closes the tested stored-occurrence
browser flows for Google RSVP and organizer content update/cancellation in both
time models. It does not certify generated meeting occurrences, series/following
writes, guest or time edits, delegation, lost-response recovery, physical native
clients, OS notifications, exactly-once email delivery or production activation.
Fake HTTP/database regressions and native device acceptance remain separate.

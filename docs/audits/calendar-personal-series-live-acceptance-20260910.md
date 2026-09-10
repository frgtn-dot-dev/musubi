# Personal series live acceptance — 2026-09-10

## Scope

Live development Musubi web/API and the connected owner's Google and Outlook
accounts, using synthetic personal events without guests. Existing local test
flags were used; production flags, versions and minimum clients were unchanged.
Provider calendars were checked independently in their browser UIs. This is
bounded functional evidence, not visual approval or physical native/OS QA.

## Outlook zoned finite create and recovery

`Musubi QA Outlook personal timed 0916` was created through Musubi in the Outlook
primary calendar: DAILY COUNT=3, September 16–18, 2026, 10:00–10:30 Europe/Prague,
no attendees. The initial native POST created exactly the correct three events.
Strict readback nevertheless left the operation in conflict: Graph returned
`Central Europe Standard Time` for the recurrence range, while the saved authored
zone and both native original timezone fields remained `Europe/Prague`.

The bounded correction recognizes only that documented pair with matching saved
and native-original context, preserving raw evidence and the full finite-family
checks. Generic timezone import and unbound adoption remain strict. The public
**Check creation** action now readmits the original uncertain create conflict
without changing its intent or permitting a replacement POST.

The original operation completed through that action at **11:31:44 UTC**. Its two
worker attempts are not two native POSTs: the second recovered the original
transaction. Musubi displayed the completed delivery receipt. Standard sync
retained one master, three children and four mappings with stable identities,
without duplicate events or extra delivery operations.

## Outlook all-day finite create

`Musubi QA Outlook personal all-day 0916` used the same September 16–18 dates,
each as a one-day all-day event, DAILY COUNT=3, with no guests. It completed in
one worker attempt at **11:38:54 UTC**. Native Outlook showed exactly the three
correct all-day dates; Musubi's series delivery displayed confirmation. Standard
sync retained one master, three children and four mappings with stable identities.

## Google bound-instance reminders

A new native Google primary-calendar series,
`Musubi QA Google instance reminder 0920`, covered September 20–22, 2026, 11:00–11:30 Europe/Prague, DAILY COUNT=3,
without guests. Each occurrence initially had a 10-minute notification. A native
description exception bound the middle occurrence, September 21.

Through Musubi, that existing instance was changed to a custom 15-minute
notification. Delivery completed and native Google showed 15 minutes for the
selected instance. Both adjacent occurrences retained their 10-minute settings;
notes and times were unchanged. A subsequent **Off** operation completed and
native Google showed no reminder on the selected instance; both siblings still
retained 10-minute notifications.

The entire synthetic Google series was deleted in native Google. Standard sync
left zero active QA events, preserving the two completed instance-reminder
journals. No email reminder was selected and no notification firing is claimed.

## Verification and retained state

Independent `graph_zone_review` found no actionable correctness issue in the
final bounded timezone and Check creation changes. Full `pnpm check` passed.
Targeted fake-HTTP, disposable-DB and UI regressions cover COUNT/UNTIL recovery,
no second POST, stable tracked sync, both DST transitions, changed recurrence/
range refusal, immutable intent and ordinary/nonuncertain conflict refusal.
These deterministic tests extend the live scenarios; they are not additional
live-provider certification.

Both synthetic Outlook series were deleted in native Outlook; its month view
showed zero events. Standard sync, without resetting its cursor, left zero active
masters and zero active children for each named series. Each family retains four
deleted rows and its completed create journal. Timed creation remains at two
worker attempts and all-day creation at one; cleanup did not change those
receipts. Google and Outlook synthetic event cleanup is complete. Unrelated
older uncertain histories remain untouched.

This run does not certify invitations, RSVP, physical devices, OS notifications,
all timezone mappings, arbitrary recurrence, Graph conditional UPDATE/DELETE,
production activation or minimum-client changes. See the
[Graph create contract](../sync/graph-recurring-create.md) and
[Google instance reminder contract](../sync/google-instance-reminders.md).

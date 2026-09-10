# Google one-off invitations and RSVP — live acceptance, 2026-09-10

## Scope and authorization

The owner explicitly approved two synthetic meetings and their invitation,
response, update and cancellation notifications between two owner-controlled
Google identities. The connected Musubi account was the organizer in the first
scenario and attendee in the second. Both operations used primary calendars.
Credentials stayed local. No unrelated events or other recipients were used.

The isolated development API enabled `PROVIDER_ORGANIZER_EDITS_ENABLED` and
`PROVIDER_RSVP_EDITS_ENABLED`. Production flags and client minima were unchanged.
The automatic scheduler remained disabled; the standard delivery worker was
invoked only for the single pending operation matching the exact QA title and
connected primary calendar. Standard Google sync refreshed provider observations.
Browser checks used the available CUA browser integration; no application code
was changed for this acceptance run.

## Organizer: Musubi to the second Google account

- Calendars exposed Create Google meeting for the connected primary calendar.
  The editor explicitly disclosed Google guest notifications and created one
  `Musubi QA invite outbound 0911` meeting with one external test guest.
- Creation completed through the standard worker. The recipient's Gmail search
  found the actual invitation, establishing delivery beyond the API receipt.
- The initial native datetime fields were filled by automation but did not
  update React state: a later text edit restored their default values. The first
  invitation therefore used September 10, 09:00–10:00 instead of the intended
  September 11 slot. This is an automation interaction limitation, not a passing
  datetime-fill test. Actual arrow-key changes committed the fields and the
  corrected values survived a subsequent text edit before submission.
- Manage Google meeting updated the title to
  `Musubi QA invite outbound 0911 updated` and rescheduled to September 11,
  14:00–14:30 Europe/Prague. Delivery completed; a fresh recipient Google Calendar
  view independently showed the updated title and exact time, awaiting response.
- The guest accepted in Google Calendar. After standard sync, Musubi displayed
  that guest as `accepted` on the organizer copy.
- The explicit Cancel meeting and notify guests flow completed. A fresh guest
  calendar no longer displayed the meeting. No automatic retry or duplicate
  create was used; this observation is not an exactly-once email delivery proof.

## Attendee: second Google account to Musubi

- The second account created `Musubi QA invite inbound 0911` for September 11,
  14:30–15:00 Europe/Prague, inviting only the connected Musubi Google identity.
  Google UI's invitation-send confirmation was explicitly used.
- Standard sync imported the correct title/time, external organizer and self
  `needsAction` response. Musubi exposed Respond in Google. Imported data retained
  a Meet link despite the attempted conference removal in Google UI; no call was
  started and this test does not claim a conference-free native resource.
- Accept submitted from Musubi and completed through the standard worker. A fresh
  organizer Google view showed the attendee as participating (two Yes responses,
  including the organizer).
- The first subsequent Tentative request was rejected before enqueue because
  Google's native version had changed. The editor retained the chosen response
  and explained that refresh/reconciliation was required. No blind overwrite or
  saved-intent rewrite was used. Standard sync and a newly opened editor allowed
  a fresh request, which completed. The organizer saw one Yes and one Maybe,
  explicitly identifying the test attendee as tentative.
- After another standard sync, Decline from Musubi completed. The organizer saw
  one Yes and one No and the test attendee marked as not participating.
- The organizer deleted the synthetic meeting in Google Calendar. Standard sync
  removed it from Musubi. Final browser snapshots showed neither QA invitation
  in either calendar. The final Musubi console query returned no warnings/errors.

## Limits

This is live evidence for the stated one-off organizer create/update/cancel and
all three attendee response values, including visible propagation to the other
account and one real invitation email. It does not certify all notification
emails, exactly-once delivery, lost-response recovery, bound recurring instances,
whole-series writes, delegates, resource bookings, Outlook/iCloud, physical
native devices or OS notification firing. Prior proofless occurrence QA receipts
from the separate series test were not retried or rewritten. OAuth secrets,
provider identifiers and account email addresses are omitted from this record.

The implementation and fake HTTP/database contracts remain in
[Google organizer actions](../sync/google-organizer.md) and
[Google RSVP](../sync/google-rsvp.md). Release and production activation remain
separate decisions.

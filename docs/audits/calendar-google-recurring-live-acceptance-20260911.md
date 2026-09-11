# Google bound recurring occurrence acceptance — 2026-09-11

## Scope

The owner authorized bounded tests between their two Google accounts. Two native
Google DAILY COUNT=3 series were prepared for September 21–23 in Europe/Prague:
an inbound attendee series at 14:00–14:30 and an outbound organizer series at
15:00–15:30. Each middle occurrence was renamed in Google to materialize a
stored exception before import. Native fixture creation is not acceptance of
Musubi recurring meeting creation, which remains unsupported.

Standard account-scoped sync ran in the isolated local QA database with time,
RSVP and organizer flags enabled and scheduled sync disabled. Both series
imported as a known-zoned master and a stored child with matching native parent
and original-slot identities. The attendee child exposed RSVP capability; the
organizer child exposed occurrence-scoped organizer capability. Exact native
master and all three instance snapshots were recorded privately before testing.
No tokens, provider IDs or raw private event bodies are included here.

## Attendee responses

The same stored middle occurrence was accepted, marked tentative and declined,
with fresh source observations between distinct requests. Each request and
operation UUID was frozen before admission. The standard `queueProviderRsvp`
service and `deliverEventOutboxAndNotify` worker completed each operation.

Independent Google Calendar inspection on the organizer account showed the
named test attendee as participating, tentative and not participating in turn.
The counts were respectively two Yes; one Yes and one Maybe; one Yes and one No.
A neighboring occurrence still showed one unanswered guest. Native comparisons
after every operation confirmed the master and both siblings unchanged in the compared fields and
the target unchanged in those fields except for its own attendee response. Comparisons included
content, time, recurrence, organizer, attendees and original-slot identities;
provider bookkeeping timestamps and ETags were not treated as user content.
These checks do not establish preservation of unexamined fields such as
reminders, event type, visibility/transparency or conference data.

This establishes bounded propagation to the organizer calendar, not exactly-once
email delivery. Receipts correctly retained notification delivery as unknown.

## Browser admission limitation

The existing backend provider connection remained usable. The local Musubi
browser session had expired, and automatic approval review blocked renewed
OAuth consent for the requested calendar-management scopes. Explicit consent
was requested from the owner. Backend tests did not complete or bypass that
OAuth consent and do not establish a fresh Musubi browser/editor acceptance.
Native Google UI checks use the already authenticated account sessions.

## Organizer update and cancellation

The outbound middle occurrence was changed through `queueProviderOrganizer`
and the standard delivery worker using a frozen request and fresh occurrence
version. Title, description and location changed; native comparison confirmed
its time, original slot and guest state preserved, with master and both siblings
unchanged in the compared fields. The guest's Google Calendar independently displayed the new title,
description and location at the original 15:00–15:30 time.

A separate frozen cancellation request completed only after the successful
update. The saved successful DELETE response marker and native cancelled child
proved cancellation; master and both siblings remained unchanged in the compared fields. A fresh
Google Calendar browser tab on the guest account showed the target absent and
both siblings present. An older open Google tab retained stale data even after
same-URL navigation, so that tab was not used as the final readback evidence.
Neither outcome claims exactly-once notification delivery.

## Cleanup and boundaries

Both finite fixture series were cancelled in their respective organizer's
native Google UI with cancellation notifications to the sole other test account.
Final read-only checks on the connected main account found both native masters
and both materialized targets cancelled. Standard account-scoped sync left zero
active local fixture rows and retained two tombstones per family. All five saved
operation receipts remained completed. Cleanup of each entire series uses
native Google functionality and is not Musubi whole-series writer acceptance. This document does not certify all-day variants, generated occurrences,
whole-series edits, delegates, lost-response recovery, physical native clients,
OS notifications, or production activation. Existing fake HTTP/database and
client regressions remain separate evidence.

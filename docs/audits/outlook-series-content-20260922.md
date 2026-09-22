# Outlook whole-series content editing — 2026-09-22

## Supported behavior

“Edit series” on web and native changes the title, notes and location of an Outlook series. The editor starts from the master's content, even when opened from a separately edited occurrence. It retains Outlook's individual field overrides, moved occurrences, cancellations, guests and times. Personal series use “Save”; meetings use the existing guest-notification action and help. The individual occurrence editor remains separate.

This applies to complete, finite personal or organizer meeting families in the verified default Outlook calendar: provider-expanded imports or canonical tracked families, at most 366 slots within the existing 730-day bound and supported time zones. `PROVIDER_ORGANIZER_EDITS_ENABLED` remains required. Rescheduling, recurrence changes, “this and following”, online meetings, shared/delegated calendars and master/exception attachments remain outside this stage. No migration or dependency is added.

## Write contract

- v4 (`outlookOrganizer=4`) adds a separate `outlookSeriesContent` proof and master content. Older readers keep their existing contracts. The action refreshes this proof before opening; a generated occurrence cannot substitute its master's proof. Admission binds the selected stored event, revision, provider state, account/default calendar, full finite family, full native master and full exceptions.
- Exactly one minimal master PATCH uses the observed weak `If-Match` ETag. There are no corrective exception PATCHes. Live testing showed that editing an exception changed the master's ETag and a stale master PATCH returned 412. Full-family checks supplement this; they do not claim a transactional Graph family snapshot.
- Outlook keeps fields independently overridden on an exception. A differing field must retain its original value. If it equals the old master, Graph does not expose whether it was explicitly overridden: either inheritance of the requested value or exact retention is accepted. Other content, fields, time, original slots, participants, cancellations and native IDs must remain unchanged.
- Full wildcard GETs can expand `exceptionOccurrences` automatically. The master comparison removes only that relation; the complete family and each full exception are verified independently. Ordinary slots are validated against the master by the existing finite-family reader.
- Graph can briefly expose mixed change tokens after accepting an update. Up to four reads over 1.4 seconds of additional delay verify the result without repeating PATCH. An unresolved mismatch remains unconfirmed.
- The existing private `graphOccurrenceContent` journal key also stores series requests, preserving deployed occurrence payloads and the established fences/retry behavior. The series request requires native exception evidence and targets the master ID/ETag/UID. Calendar admission fences imports and other family writes. Completion atomically updates every retained active local member's verified content and all observed mapping versions; time models and cancelled local slots are retained.
- A permanent pre-dispatch marker prohibits a second PATCH after a possible send. Durable acceptance plus exact readback is required; merely observing desired content does not prove an interrupted send was accepted. HTTP 412 and definite undispatched refusal release the fence. Generic ACK/rebase paths stay unavailable. A no-op makes no write.

## Evidence and checks

[Redacted live evidence](evidence/outlook-series-content-20260922.json) covers new disposable COUNT=4 personal and meeting series, each with an independent content exception, a moved exception and a cancelled slot. Actual admission/outbox/Graph delivery completed title, notes/location and explicit clear updates. The stale PATCH returned 412, title-only updates retained HTML, individual content and moved time survived, and cancelled slots stayed absent. Cleanup returned 204 for personal deletion and 202 for meeting cancellation; native absence and local fixture cleanup were verified. Invitations/updates/cancellations went only to the previously authorized test recipient; mailbox delivery is not asserted.

Early synthetic probes revealed wildcard relation expansion and transient post-update version mismatches. Every probe series and its own local rows/journals were removed. No existing user event was modified.

Integration checks cover both storage models, a master target, all-day, moved/cancelled slots, differing/partial/equal-valued overrides, no-op/clear, stale admission/delivery, changed authority/account/local revision, partial reads, private native field drift, changed guests, 412, lost responses, restart, durable recovery and delayed readback. Regression coverage includes single occurrence updates, one-off meeting content and recurring cancellations. Web/native tests cover master draft content, revoked proof and frozen retries. Chromium verified 1280px light and 390px dark flows, keyboard focus return, accessibility, layer placement and overflow. Native device testing was not performed. Repository Playwright was used because the Browser skill was unavailable.

No release or production deployment is included.

Reference: [Microsoft Graph update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0). Graph can send a series notification plus updates for separately edited instances; the application does not claim guest notification delivery.

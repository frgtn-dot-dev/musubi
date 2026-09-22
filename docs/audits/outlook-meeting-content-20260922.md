# Outlook one-off organizer content updates — 2026-09-22

## Scope

Web and native clients can edit the title, notes and location of an owned,
non-recurring Outlook meeting through the existing explicit organizer editor.
The action requests guest updates. The native time, original time zones and
invitation list are never serialized into this PATCH. Guest mailbox delivery
is not observed and is always reported as unknown.

Admission requires the active owner connection to its verified default Outlook
calendar, complete organizer/guest evidence, one authoritative local membership,
matching local revision, provider-state version, native ETag and displayed event
projection. Conference/online meetings, attachments, resource attendees,
attendee copies, shared/delegate calendars and recurring items stay unavailable
for this edit path. The capability uses the existing v2 observation opt-in;
v1 clients retain their cancellation-only capability. No new public response
field, database migration or dependency is introduced.

## Delivery and recovery

- The immutable intent stores the complete native baseline and the minimal
  changed-field payload. Clearing notes/location is explicit. Leaving notes
  untouched does not replace rich HTML with Musubi's plain-text projection.
- Dispatch revalidates the Graph/account/calendar identity, complete native
  baseline and current local source/lease. The PATCH uses the exact native weak
  ETag; previous live evidence observed a stale version being rejected with 412.
- The durable dispatch marker precedes the network request. No subsequent
  worker attempt can repeat a possible guest notification. Completion requires
  persisted HTTP 200 acceptance for the exact native identity and full readback
  matching the desired content and preserved fields. A no-op sends nothing.
- A lost response, process restart before acceptance, wrong response identity,
  missing copy or changed readback remains unresolved. Read-only checks do not
  infer notification acceptance from matching content alone.
- An explicit 412 from this attempt is a definite rejection. Its terminal result
  is recorded with the active lease; an undispatched conflict can also stop.
  Only that operation's still-current optimistic fields are restored. Sync can
  resume, and a new request after refresh does not depend on the stopped one.
  A lost lease or unknown outcome cannot use this escape hatch.
- The common organizer completion path independently rejects acknowledgement of
  a dispatched Outlook update without persisted acceptance. Generic conflict
  resend and acknowledgement remain unavailable for organizer operations.

## Evidence

[Redacted live implementation result](evidence/outlook-meeting-content-20260922.json)
records a new disposable one-off meeting with the user-approved test guest.
The actual DB → organizer outbox → Graph path completed three edits: title,
notes/location, and clearing notes/location. The title edit preserved the exact
HTML body. Authored Europe/Prague times, UTC observations and the guest remained
unchanged throughout. Cleanup cancelled the test meeting with HTTP 202, verified
404 and removed its local row. Existing meetings were not mutation targets.

The isolated database suite covers timed/all-day updates, no-op, explicit clears,
stale admission/delivery, projection mismatch, concurrent 412, successful fresh
replacement after rejection, incomplete guests, online/attached/recurring items,
permission and identity loss, missing copies, wrong success identity, local
revision races, accepted recovery and lost-applied/lost-retained responses with
no resend. Existing Outlook cancellation and Google/CalDAV organizer suites
remain regression checks.

The shared editor was checked with Chromium at 1280×900 in light mode and
390×900 in dark mode: keyboard operation, focus return, layer order,
accessibility, no overflow, and frozen retries. The first desktop run encountered
Vite's initial dependency rebuild; both scenarios passed with a warmed server.
The Browser skill is not installed, so these checks used the repository's
Playwright workflow. Native editor tests cover the same content-only request and
retry behavior; no native device run was performed for this change.

## Remaining scope

This is not recurrence editing, rescheduling, guest management or online-meeting
body editing. Those require separate native preservation and notification
verification. The earlier cancellation support is unchanged. No release,
production deployment or feature-flag change is part of this work.

References:
- [Microsoft Graph: update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0)
- [Earlier live organizer conditional-write evidence](outlook-series-meetings-20260922.md)

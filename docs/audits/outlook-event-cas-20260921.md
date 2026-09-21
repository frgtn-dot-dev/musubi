# Outlook personal event PATCH and unsafe DELETE — 2026-09-21

## Result

A delegated personal Outlook account accepted the exact native `W/"…"`
`@odata.etag` for conditional event **PATCH**. Both an old real version and a
version from another synthetic event produced **412** without changing the
observed event content. The same endpoint **ignored the stale condition for
DELETE**, returning **204**, with a following GET returning **404**.

Enable only title, description and location PATCH for owned, non-recurring,
attendee-free, non-online personal events. Keep deletion, time changes, recurring
items, meetings and delegated/shared-calendar mutations outside this path. This
is bounded live evidence, not a general Microsoft Graph conditional-write
contract or certification of every Microsoft tenant.

## Reproduction and evidence

The owner reconnected Outlook to the isolated local preview for this test. Each
run created its own uniquely named calendar and only new synthetic events with
no attendees and reminders disabled. No existing calendar/event was selected as
a mutation target. Each calendar was deleted and its absence verified by GET.

- [Initial probe](evidence/outlook-event-cas-20260921-initial.json): fresh title
  PATCH preserved rich omitted body/location/time. Stale PATCH returned 412;
  full-response equality was too strict for server-managed metadata. A made-up
  tag returned 500, so that negative control was inconclusive. Stale DELETE
  removed both the zoned and all-day event.
- [Real-version controls](evidence/outlook-event-cas-20260921-controls.json):
  unrelated genuine event versions also produced 412. Content comparisons
  exclude response metadata. The description readback initially compared text
  with Graph's HTML representation; it was not counted as verified.
- [Final probe](evidence/outlook-event-cas-20260921-final.json): descriptions
  read with `Prefer: outlook.body-content-type="text"`. Every PATCH check
  passed for a zoned and an all-day event. DELETE again ignored stale versions.
  `patchVerified: true`; overall `verified: false` deliberately records that
  DELETE is unsafe.
- [Implemented transport](evidence/outlook-content-transport-20260921.json):
  the actual new `updateMicrosoftPersonalContent` transport edited a new event,
  preserved omitted fields, rejected the old version, and explicitly cleared
  notes and location. A first immediate post-create attempt encountered a
  provider version change and correctly refused before PATCH; the successful
  smoke test used a stable post-create baseline. The transport does not sleep,
  retry stale writes, or replace the accepted version with a newer read.

Probe: `scripts/probe-outlook-event-cas.mjs`. Its offline self-test is
`node scripts/probe-outlook-event-cas.test.mjs`. A live run requires `--live` and
an access token supplied through `OUTLOOK_CAS_TOKEN` in the environment (never
in a command argument or checked-in file). It creates and cleans up its own
calendar; JSON output contains statuses/request IDs and booleans, not tokens,
mailbox addresses or existing calendar contents. Failed cleanup retains only
the synthetic calendar identity for manual cleanup.

## Implementation boundary

- Keep Graph's native weak ETag unchanged and accept it **only** for this PATCH
  path; Google's and CalDAV's strong-validator rules remain unchanged.
- Before local admission and again before delivery: verify OAuth write grant,
  current calendar write permission and owner against `/me`, source/event
  identity, exact accepted version, and complete native personal-event shape.
- Serialize only the server-computed changed title/description/location fields.
  A local color change sends no Graph PATCH. Other changed fields are refused.
- Send one conditional PATCH, no redirects, no unconditional fallback. Missing
  response version becomes null; an invalid success identity is unconfirmed.
- Reuse the existing outbox, conflicts and reconciliation. Lost responses can
  be recovered by observing accepted content; a newer read is not automatic
  authorization to overwrite it.
- Delete is refused before local mutation and at the direct adapter boundary,
  with a concrete instruction to delete in Outlook.

Tests cover genuine adapter + Postgres admission/delivery, accepted-version
storage, no local change on stale preflight, concurrent remote change, ambiguous
response reconciliation, and direct guards. The authenticated event capability
and Google/CalDAV provider-write regression suites also pass. Their local HTTP
fixtures require the same test-only `FEDERATION_ALLOW_PRIVATE_HOSTS=true` setting
as CI; production networking policy is unchanged.

## Primary documentation

[Update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0)
documents omission preservation, but does not establish event-specific If-Match
behavior. [Delete event](https://learn.microsoft.com/en-us/graph/api/event-delete?view=graph-rest-1.0)
does not establish conditional deletion. Neither `changeKey` nor a mocked HTTP
server is proof of those remote semantics; the live results above distinguish
PATCH from DELETE.

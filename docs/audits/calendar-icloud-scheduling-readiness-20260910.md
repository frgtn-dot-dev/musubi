# iCloud scheduling discovery: read-only evidence, 2026-09-10

## Scope

A bounded authorized probe used the connected iCloud account in the disposable
local QA database and its two already linked event collections. It read account
credentials privately, selected existing links, and made only guarded OPTIONS
and Depth 0 PROPFIND requests with redirects disabled. It performed no event
listing, content read, database mutation, resource creation, invitation, RSVP,
PUT or DELETE. No credentials, email addresses, principal/resource URLs or
personal content are recorded here.

This records the earlier live probe; documenting it did not make another live
request. The implementation under test was the working branch
`codex/calendar-scheduling-acceptance-20260910`, following PR #272. The observations
below establish discovery readiness only, not scheduling delivery acceptance.

## Observations

Both linked collections produced the same results:

| Read-only check | Observed result |
| --- | --- |
| Collection OPTIONS | HTTP 200; `calendar-auto-schedule` advertised |
| Collection identity PROPFIND | HTTP 207; one exact response; `current-user-principal` explicitly empty 404, `owner` 200 with a valid same-origin href |
| Same-origin root principal PROPFIND | HTTP 207; one exact response; `current-user-principal` 200 with a nonempty valid same-origin href exactly matching the collection owner |
| Configured account-server principal PROPFIND | HTTP 207 but no exact requested-URL response; rejected as proof |
| Principal address set | HTTP 200 property; four unique href leaves: one mailto, one opaque `urn:uuid` reference, two absolute-path references |
| Principal outbox URL | HTTP 200 property; valid same-origin href |
| Outbox type and privileges | HTTP 200 properties; valid collection/schedule-outbox type and privilege structure; send-reply and send-invite checks satisfied |
| Collection privileges | HTTP 200 property; valid structure; create/bind and delete/unbind checks satisfied |
| Updated production `readCaldavSchedulingProof`, action `create` | Accepted for both collections with one selected mailto identity and principal equal to owner; this function performed only metadata reads |

The original collection-only discovery gate refused the explicit 404. The
bounded root query supplies authenticated identity rather than inferring it from
ownership. The original all-mailto check also refused the heterogeneous address
set. The updated reader validates URI reference syntax, selects verified mailto
members for email matching and neither dereferences nor interprets non-email
members as email. The opaque URN is not asserted to be a canonical UUID.
[RFC 5397 section 3](https://www.rfc-editor.org/rfc/rfc5397.html#section-3) defines
current-principal discovery;
[RFC 6638 section 2.4.1](https://www.rfc-editor.org/rfc/rfc6638.html#section-2.4.1)
allows calendar-address hrefs including principal-resource URIs.

Local fake-HTTP tests cover empty-404-only root discovery, denied/malformed/foreign
proof, empty href rejection, duplicate and malformed address members,
operation-specific privileges, and refusal before resource GET or PUT when
resource permission is unknown or denied. Existing RSVP/organizer regressions
and API typechecking also passed. These local checks are separate from the live
metadata observations above.

## Remaining acceptance boundary

No iCloud invitation or RSVP scenario has passed in this investigation. The
user has not yet confirmed the email address for the proposed invitation test.
Organizer create, guest delivery, attendee response, update and cancellation
remain unexecuted as live scheduling operations; a positive create-capability
proof is not a created event or delivered invitation.

Resource `write-content` was not established in this probe and remains unknown
for scheduling. Earlier synthetic personal-resource probes returned unavailable
resource privileges; see the
[resource permission evidence](calendar-icloud-series-live-acceptance.md#follow-up-acl-diagnostic-and-approved-alternative-2026-09-10).
Collection bind/unbind and positive outbox privileges do not substitute for the
resource permission required by RSVP or organizer updates. The separately
approved personal master-content fallback does not apply to scheduling.

Next live acceptance requires the confirmed test recipient and a bounded
synthetic scenario. RSVP and organizer updates additionally require affirmative
resource-write proof under their existing contract. Nothing here enables
production flags, changes minimum versions, or proves notification delivery.

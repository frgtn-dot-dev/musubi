# Google RSVP: evidence contract

**Live evidence update — 2026-09-10:** the bounded one-off organizer
create/update/cancel and attendee accept/tentative/decline paths passed between
two approved Google accounts. Other-account Calendar UI and one real invitation
email were observed; both synthetic meetings were cleaned up. This does not
certify exactly-once notification delivery, every email, lost-response recovery,
bound recurring instances or physical devices.
[Full evidence and limitations](../audits/calendar-google-invite-live-acceptance-20260910.md).
Live-pending statements below describe the original implementation checkpoint
unless they name a remaining scope explicitly. Production activation remains
separate.

The default-off RSVP capability supports the connected account's own primary
Google copy of a one-off meeting or an existing materialized instance. The public
endpoint, private journal, conditional worker, explicit conflict resolution and
web/native controls are connected. Series masters, unbound/generated slots and
unsupported native evidence remain refused. Live two-account acceptance and
production activation are separate gates; notification delivery stays unknown.

The sections below describe the layers and their local evidence. The current
public instance contract is summarized in [Public instance RSVP](#public-instance-rsvp).

## Native request

Google documents `attendeesOmitted` as supporting participant-response updates.
The planner emits that marker and exactly one attendee's email/responseStatus;
it never resends the attendee array or copies other event fields into a PATCH.
References: [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [PATCH semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).
The documented more-than-200-guest propagation boundary is unsupported here.
These protocol assumptions are covered by local HTTP tests, not live acceptance.

## Identity and preservation

The authenticated adapter derives `authenticatedCopyEmail` from
its connected provider identity. Client request JSON, Musubi attendance, and
calendar ownership cannot supply that proof. The pure planner requires the
accepted external event ID, strong ETag, one matching self attendee, a different
organizer, full attendees and a normal active event with explicit endpoints.
An instance additionally requires its accepted parent and original slot.
Organizer/resource self entries, private copies, locked/special events, series
masters and unbound instances are refused. Defaults such as organizer.self=false follow Google's resource
contract; missing organizer identity is not accepted.

The private baseline is cloned. Confirmation permits only the intended self
response and provider ETag/update timestamp to change. All other native data,
including attendee extras, time zones/folds, reminders, conferences, sequence
and unknown fields, must remain equal. A truncated response or unrelated change
cannot confirm the result. This deliberately conservative comparison may reject
provider normalization; it must not be weakened without preservation evidence.
A returned ETag is only a comparison result, not permission to update database
mappings independently of local CAS, source ownership and worker fencing.

## Evidence and remaining work

`apps/api/src/sync/adapters/google_rsvp.test.ts` checks all three responses,
minimal body, case-preserving self identity, frozen baseline, all-day/zoned
endpoints and preservation/refusal cases. The suite is included in API tests.
The subsequent HTTP and database sections establish transport and durable evidence.

The internal transport below adds primary-account binding and conditional HTTP.
Source authorization, durable recovery, conflict semantics and clients are
implemented below; live two-account acceptance remains pending. Notification delivery is not proven exactly-once
by seeing the desired response in a subsequent GET. Organizer create/update/
cancel, withdrawal and broader recurring RSVP need their own contracts. No change to
feature flags, versions or compatibility minima is made here.

## Default-off internal HTTP transport

`PROVIDER_RSVP_EDITS_ENABLED` defaults to false. Both adapter entry points refuse
before token or network access when disabled. Production wiring refreshes the
exact user/account token and then verifies its OAuth event-write scope.
A fresh `calendarList/primary` GET must return an owner grant, `primary: true`,
and an email matching the selected external calendar. That provider-derived
identity is compared with the one self attendee; secondary/delegated calendars
are unsupported in this slice. [Primary calendar lookup](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get)
is documented by Google.

The writer rebuilds the minimal patch from its baseline and performs a complete
fresh GET. An already-matching desired response returns without PATCH. Otherwise
the entire accepted baseline must still match before an `If-Match` PATCH with
explicit `sendUpdates=all` and `conferenceDataVersion=1`. The notification policy
is required by the internal caller and does not imply current live authorization.
Redirects and partial reads are rejected; all URLs remain on the fixed Google
origin, with encoded calendar/event IDs.

After successful mutation, another full GET proves preservation. Network loss or
an applied 503 leaves an unconfirmed outcome; a subsequent invocation reads and
recognizes the applied result without a second PATCH. Concurrent native changes
block automatic retry. The returned `notificationDelivery: unknown` never claims
an email was delivered or sent exactly once. An unchanged baseline after an
unapplied 503 permits a conditional retry; stronger notification guarantees still
require live provider evidence and the durable worker contract.

`google_rsvp_delivery.test.ts` exercises real HTTP against a local fake server:
primary identity, disabled/auth-error gates, exact body/query/If-Match,
truncated successful PATCH plus full GET, lost response, applied/unapplied 503,
412 race, same-ETag drift and post-write conference change. The injected token
reader is synthetic; this does not substitute for DB/account authorization,
worker lease/replay, source ownership, or live organizer-visible acceptance.
No external accounts are used by these tests.

## Internal transactional preparation and enqueue

`queueGoogleRsvp` is an internal service, gated by the same disabled RSVP flag.
It first resolves the actor's own live source, editable membership, mapping,
canonical revision and private state version under the established lifecycle /
event / membership / mapping lock order. It returns an exact prior receipt before
provider I/O on replay. Other pending or cancelled source history blocks a new
operation. Floating/cancelled events, series masters and generated slots remain unsupported.
Existing materialized instances use the bound family contract below.

A fresh OAuth-authorized native read must match both the stored canonical event
(including known civil time) and imported private provider state. The commit then
locks and reconstructs the full local context. Revision, role, link/account,
map identity, ETag, state or calendar-link changes reject the stale preparation.
Concurrent identical requests converge on one operation UUID/receipt. The private
outbox contains the raw baseline and separate baseline/desired provider states;
it does not alter canonical event content/revision, social attendance, accepted
provider observation or local reminders.

The public route uses this transaction. Generic ACK and generic content conflict
resolution refuse the intent; specialized RSVP paths described below confirm it
shape. The specialized worker and pull comparison described below use their own
proofs. A private queue row alone is not delivery.

`provider_rsvp.integration.test.ts` exercises actual token/account lookup,
Google read adapter and PostgreSQL against a fake server: disabled/wrong-user/
wrong-scope/viewer refusal before HTTP; concurrent replay; revision, role,
mapping, native state and time races; legacy/zoned/all-day preservation; and no
generic worker PATCH; the specialized worker tests below extend these fixtures. It is part of `test:db:events` and `test:db:sync`.
No live invitations, endpoint, migration, rollout or version change is included.

## Specialized durable delivery and pull coordination

The RSVP worker validates the private request/baseline and exact live source,
OAuth identity and claimed lease before provider work. A callback immediately
before the conditional PATCH rechecks the local membership, mapping/state,
revision and lease after the provider read. Recovery uses the saved native
baseline; it never rebuilds intent from a newer local event.

Only `completeProviderRsvpOutbox` can confirm this payload. Inside the existing
lifecycle/event/outbox/mapping transaction it fences the lease, locks editable
membership, requires the exact source revision and original mapping/state CAS,
and verifies the desired private state. Generic ACK remains unavailable.
Canonical event content/revision is unchanged; the accepted ETag and private
provider state advance together. Permission/revision loss after PATCH remains
unconfirmed, and a lost lease cannot ACK another worker's operation.

An unchanged accepted native baseline during preparation is retained without
creating a false conflict. After an attempt, exact native desired state plus
canonical time/content identifies an echo; another attendee response, reminder
or time-zone change remains a retained conflict. RSVP alone enables temporal
evidence for this comparison without enabling canonical time-model adoption.
Generic content conflict resolution remains refused; native RSVP conflict
resolution is a follow-up.

The HTTP/DB suite additionally covers confirmation, replay after applied 503 and
connection loss, lease recovery without duplicate PATCH, permission loss before
PATCH/at ACK, blocked generic ACK, private Delivery projection, and real fetch
adapter → pending pull for baseline/echo/state/zone cases with only RSVP enabled.
No endpoint, client flow, real invitation or live organizer-visible acceptance
is provided by this worker slice. Notification delivery remains unverified.

Review regression: the intent also stores the normalized time of the **native**
baseline. Pull echo matching uses that proof even when the canonical event is
legacy-unknown. A Prague→Berlin change with equal instants after confirmation
must remain a conflict. Missing/unknown native time cannot establish an echo;
it fails closed. The worker checks the saved proof against raw baseline before
writing. The canonical time model is not adopted by this comparison. A dedicated
legacy regression reproduced the erroneous completion before this fix.

Further preservation checks: projected pull equality is only an echo candidate.
The ACK requires any retained candidate to have the exact resource ID/ETag of
the full native confirmation GET. Another pulled version remains a conflict,
even when only an attendee comment or another unprojected field changed; a later
local timestamp cannot replace it. RSVP-only import preserves ordinary legacy
reads of valid multi-zone events while withholding unsupported temporal evidence.
Such a missing proof cannot satisfy pending RSVP echo comparison.

## Authenticated HTTP enqueue

`POST /api/v1/events/:eventId/provider-rsvp` accepts the strict
`ProviderRsvpEditSchema`: a frozen operation UUID, revision and private state
version, Google provider, accepted/tentative/declined response, and explicit
`sendUpdates: "all"`. The endpoint uses normal authentication and client version
checks. The source account must belong to the caller; editing a shared calendar
never grants permission to respond for its owner.

The default-off flag, source/revision/state checks and fresh OAuth/native evidence
remain mandatory. A 202 response contains only operation ID, replay status,
outbox status, `localCommitted: true` and `notificationDelivery: "unknown"`, with
`Cache-Control: private, no-store`. It confirms durable intent acceptance, not
canonical content change or email delivery. Identical replay returns the same
receipt even after completion, without another provider read or send. Changing
a request while retaining its UUID is refused.

HTTP tests cover absent/invalid identity, obsolete client, malformed input,
unsupported notification policy, disabled flag, viewer/shared editor denial,
private receipt shape, unchanged canonical event and pending/completed replay.
The worker still performs the actual conditional write. Client controls, native
RSVP conflict resolution and live two-account acceptance remain follow-ups.

## Default-off web and native response controls

The private provider-state response may advertise `rsvpEdit` only for the caller's
editable one-off Google source, a strong version, complete bounded attendees and
one self identity matching the source calendar. Organizer copies, unsupported
event kinds, series and floating events remain unavailable. This is a queue
capability; the endpoint and worker still require fresh provider identity and
write evidence.

Web and native details reload the observation before every opening. They retain
the selected response and frozen revision/state/operation identity for an
identical retry, require an explicit response choice, and state the provider
notification policy before submission. A pending receipt never claims a sent
email or an accepted organizer-visible response. Existing account/server context
boundaries discard the dialog on a context change. The web dialog hands focus
back to the calendar trigger and isolates portaled keyboard/pointer events.

Client tests and mock-API Chromium checks cover explicit choice, no write on
cancel, failed submission and exact retry, refreshed/revoked capability, narrow
dark/light rendering and accessibility. Physical native QA and live two-account
acceptance remain deferred; no production flag was enabled.

## Explicit native RSVP conflict resolution

The receipt owner can preview a supported one-off conflict against a fresh,
authenticated native Google read. The preview exposes only saved/current own
response and an opaque hash of the complete native baseline; attendee comments,
private properties and conferences remain private. The hash includes fields
outside the normal provider-state projection, so even a changed native comment
at an unchanged ETag invalidates the old preview.

Confirmation re-reads the native baseline and validates the exact preview,
source/revision/mapping/private-state/permission context and pending chain under
locks. It atomically supersedes the old receipt and enqueues the saved response
against the current native baseline. Canonical content is unchanged. The normal
conditional RSVP worker preserves all other current fields; if the desired
response is already present it can confirm without another PATCH. Missing or
stale preview identity, permission loss, another native change or unsupported
time/series context prevents replacement.

Web/native comparison shows only the two own responses and Google's notification
policy, retaining the exact preview and mutation identity on retry. Tests cover
private HTTP preview, same-ETag unprojected change, role loss, replay, conditional
replacement preserving another attendee and recovery without duplicate PATCH.
No live invitations or production capability activation are included.

## Bound instance evidence and conditional transport

The private native RSVP adapter can verify an existing instance only when its
caller supplies an accepted external parent ID and original occurrence identity.
Both must match the full Google response. A moved start does not redefine the
original slot; explicit offsets distinguish the repeated DST hour. Missing,
ambiguous or sub-millisecond identity, masters and unbound instances are refused.
The frozen evidence retains this binding and the writer rebuilds it before I/O.

Only the instance URL receives the minimal self-response PATCH with its own
If-Match validator. Full readback preserves the parent, original identity, actual
time and all other native fields. Recovery after an applied 503 or lost response
does not resend the PATCH. This proves neither whole-series protection nor
exactly-once notification delivery. The existing default-off flag still applies.

`google_rsvp.test.ts` covers all three responses, moved all-day/zoned instances,
DST folds, identity refusal and complete preservation. The real fake-HTTP
`google_rsvp_delivery.test.ts` covers binding, minimal conditional PATCH,
recovery, races and fresh conflict-preview reads. These are local evidence,
not organizer-visible live acceptance. Public instance support also requires the
accepted parent/child journal, durable ACK and conflict resolution described below.

Provider references: [event identity and attendee response fields](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [PATCH method](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).

## Private instance journal and accepted family binding

The instance path of `prepareProviderRsvpEdit` derives the existing child,
original slot, external parent and parent mapping from accepted local state.
It freezes the parent revision as a local consistency fence; that revision is
not a provider validator. Both events must remain live in the same owned source,
with known supported temporal models and matching mapping identities. Unresolved
parent work prevents queuing an independent child response.

Commit locks the parent before the child, re-derives this context, then stores one
private RSVP intent atomically. Concurrent commits and replay reuse its identity.
Neither canonical content/revisions nor accepted mappings change when queuing.
`provider_rsvp_instance.integration.test.ts` covers moved zoned/all-day children,
parent revision/mapping/deletion/unlink races, child/mapping identity drift,
pending/cancelled parent work, tampering and concurrent retry.

The specialized worker/ACK and conflict-resolution layers below validate this
private journal. Generic content delivery and generic ACK remain unavailable.

## Instance worker, full confirmation and pull coordination

The private instance worker re-derives the accepted family binding before reading
and immediately before PATCH. Its full native RSVP proof binds the instance URL,
parent and original slot; a separate RSVP projection compares actual content and
known time without relaxing the one-off reminder contract. A timed instance
without explicit native zone evidence remains unsupported in this slice.

ACK locks parent before child, verifies the retained binding and current mapping,
then advances only the confirmed instance's provider state/ETag. Parent revision,
parent mapping, permissions or lease changes prevent confirmation. Pending pull
requires the same canonical parent, original identity, temporal model and desired
state, and is only a candidate echo: full native readback is still authoritative.
Retry after an applied 503 or lost response confirms the result without another
PATCH. Later echo import keeps the existing child identity and canonical revision.

The real HTTP/DB `provider_rsvp_instance.integration.test.ts` exercises both time
kinds, recovery, parent/child/mapping changes, permission loss before and after
PATCH, lease loss, native original-identity drift, interleaved pull and stable echo.
Generic ACK remains unable to confirm RSVP. Public instance enqueue/capability
and explicit conflict resolution use this specialized path; no live RSVP or
production flag activation is implied by its local verification.

## Explicit instance RSVP conflict resolution

A fresh conflict preview may accept a newer local parent revision, while keeping
the same canonical parent, external parent and original slot. The opaque preview
version binds both the complete native baseline and the accepted parent mapping/
revision. An unchanged instance JSON therefore cannot validate an old preview
after a parent change. Private attendee comments also invalidate a stale preview
without appearing in the public response.

Commit locks parent before child, re-derives the binding and atomically replaces
the old intent with a fresh baseline. The new worker preserves current native
fields and resends only the saved self-response; an already-applied response
completes without another PATCH. The HTTP/DB instance fixture covers stale parent
revisions (including freshly rebuilt proof against an old request), private
comments, foreign parent/slot refusal, permission loss, frozen replay, explicit
resend and already-desired recovery for all-day and zoned instances. This does
not claim live organizer acceptance; public instance controls are described below.

## Public instance RSVP

The authenticated RSVP endpoint now accepts an existing active detached instance
when its own source, canonical parent, original slot and native Google copy agree.
The server derives the entire binding; the unchanged strict public request accepts
no parent/occurrence override. Preflight has a ten-second read deadline. It commits
one durable intent and returns 202 without sending a PATCH inline. Concurrent
requests and retry use one receipt. Masters, generated slots, foreign native
parent/original identity and stale family state are refused before queuing.

Private observation advertises this supported scope only under the default-off
RSVP flag and a valid accepted family. Fresh preflight still verifies native
identity, permissions and time; a timed native instance lacking explicit zone
evidence remains unsupported. Reminders retain their separate one-off contract.
No wire fields, product versions or compatibility minima changed.

Web and native controls say “Respond to this occurrence” and retain the child UUID
and scoped context. Opening refreshes capability; retry freezes the request and
keeps the selected response. Context changes discard the old editor. Existing
shared dialogs/buttons and focus return are reused, with no new styling or UI
library. Generated/master views receive no instance capability.

Evidence: authenticated HTTP/DB in `provider_rsvp_instance.integration.test.ts`
checks flag/auth/schema refusal, master and foreign identity, parent race,
concurrent 202/replay, no inline PATCH and real worker delivery through synthetic
OAuth. Native component tests verify child targeting; web tests verify scoped
context reset. Playwright covers 1280/light and 390/dark editor retry, explicit
scope copy, accessibility, no overflow/overlay or application console errors and
focus return, alongside existing RSVP conflict controls. Browser plugin/skill was
not listed, so the repository's Playwright workflow used an isolated localhost
port. Screenshots and logs remain outside the repository. Physical native devices,
real invitation delivery and live organizer-visible responses remain unverified.

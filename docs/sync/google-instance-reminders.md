# Google reminders for existing instances

The native transport targets an existing bound instance on the connected
account's own primary calendar. The default-off reminder flag blocks provider I/O.
Public actions require the server capability and remain disabled by default.
No production activation is included.

The accepted native instance ID, parent ID and original date/instant are checked
independently of a moved current start. Timed instances require an explicit known
current zone; historical or missing zone data cannot authorize a write. Masters,
floating/ambiguous time, partial attendee lists, locked/private-copy/special-type
events and unknown reminder methods are refused. The requested reminder shape is
limited to defaults/off or up to five popup/email overrides.

A fresh primary-calendar ownership check and exact full instance read precede
one conditional PATCH with only `reminders` and `sendUpdates=none`. A required
callback rechecks local authority immediately before mutation. Intent is cloned
before asynchronous reads. Confirmation uses a complete fresh GET, comparing all
native fields except the requested reminders and provider ETag/update timestamp.
Changed native content is a conflict; missing/partial confirmation is unconfirmed.
An already confirmed desired result recovers without another PATCH. An instance
ETag never establishes a whole-family concurrency guarantee.

Pure and fake HTTP regressions cover zoned/all-day original identity, moved time,
defaults/off/custom settings, field preservation, lost/error responses, malformed
successful bodies, confirmation failure, replay, native/local denial, conditional
races, signal abort and caller mutation. Durable local fences, delivery, explicit conflicts and client integration are
described below. Live acceptance remains separate.
No invitations or real account writes are performed by these tests.

Google describes reminders as private settings for the authenticated user in its
[reminder documentation](https://developers.google.com/workspace/calendar/api/concepts/reminders).
Native instance identity follows the [recurring-event contract](https://developers.google.com/workspace/calendar/api/guides/recurringevents).
These API contracts do not replace live acceptance of Musubi's implementation.

## Private durable instance journal

Preparation captures the accepted local parent revision, parent mapping, child
mapping and original slot under lifecycle and parent-before-child locks. Native
preflight runs outside the transaction. Commit re-reads the entire context and
requires the same revision, source, permission, mappings, provider state and known
native time before storing the full baseline and personal reminder intent.

A concurrent replay of the same actor/operation/request returns one receipt.
Changed requests, pending child or parent work, cancelled previous source work,
permission loss and changed bindings cannot enqueue a replacement implicitly.
Neither canonical event revision nor accepted provider mapping changes on enqueue.
The claimed-source helper checks the current lease and accepted binding again.
Generic ACK and generic content-conflict proofs refuse this private journal. The
specialized worker/ACK is described below; public composition is described below.

Disposable PostgreSQL regressions cover zoned/all-day moved slots, defaults/off/
custom intent, concurrent replay, stale parent and mapping, deleted/unlinked parent,
changed child revision/original identity, permission and lease loss, and generic
path isolation with zero provider I/O.

## Specialized delivery and acceptance

The default-off worker rebuilds the native evidence from the journal, checks it
against accepted content/time/provider state and requires the exact live lease,
source and parent binding before provider I/O and immediately before PATCH. Only
a complete native read can confirm or recover the requested result. An inactive
Google override list under `useDefault: true` is preserved as observed state; it
does not change the meaning of choosing calendar defaults.

The specialized ACK re-locks parent before child and atomically rechecks membership,
source, mapping version, parent binding and live lease before accepting the observed
ETag and personal state. A concurrent pull remains a candidate; another native
version or unrelated state cannot be hidden by a later ACK timestamp. Canonical
event content and revision remain unchanged. Transient ACK storage failure leaves
an unconfirmed operation that can recover by full read without a second PATCH.

Actual adapter/fake HTTP/PostgreSQL coverage includes defaults/off/custom, concurrent
workers, applied lost/503 responses, failed ACK storage, pre/post-write parent and
permission changes, changed lease/native original/unknown fields, baseline and echo
pulls, foreign pulled state, and default-off refusal. Public admission and client acceptance are described below.

## Explicit conflict confirmation

An own-source conflict can be refreshed with a complete native instance read. The
preview carries only the existing public reminder fields and an opaque version
that binds every native field, mapping and accepted parent/slot context. A newer
parent revision can be adopted explicitly; a different parent or original slot
cannot. A changed parent or an unprojected native field invalidates an old preview.

Confirmation rechecks current membership, mapping, journal chain and bound context
under locks, accepts the fresh native baseline and writes a new private instance
intent. Generic content and one-off reminder proofs cannot substitute for it.
Concurrent identical confirmations return one replacement. The worker either
applies only the saved reminders or confirms an already applied result without
another PATCH, preserving the current unrelated provider state and native fields.
Zoned/all-day PostgreSQL and fake HTTP regressions cover resend/recovery, stale
previews, private-field changes, reparenting/original-slot refusal, permission loss
and concurrent confirmation/replay. No raw native fields enter the public preview.

## Public admission and clients

The existing strict `provider-reminders` endpoint now selects the bound-instance
contract for a saved child. It reads native evidence outside database locks and
commits only after full local context revalidation. Parent IDs and original slots
are server-derived and cannot be supplied in the request. An exact replay returns
the durable receipt without another native read. HTTP 202 with private/no-store
caching means local acceptance, not completed Google delivery.

Web and native editors require a refreshed server capability, identify the action
as applying to this occurrence and retain the same request on a failed unchanged
retry. Changing account/scope clears the editor. Web event details expose separate
occurrence and series delivery histories so the child's conflict is reachable.
The normal one-off editor keeps its existing contract.

Actual authenticated HTTP/PostgreSQL regressions cover strict DTO/auth/flag guards,
concurrent receipt identity, parent/native races and worker completion. Web/native
component tests cover exact child targeting and retry. Browser/mock acceptance
covers zoned/all-day instances at 1280 px/light and 390 px/dark, keyboard and focus,
accessibility, failed draft preservation, exact request replay and both delivery
targets, plus the prior one-off editors. This does not replace live Google reminder
acceptance or physical native/OS notification QA.

## Bounded live acceptance — 2026-09-10

A guest-free primary-calendar DAILY COUNT=3 series had its middle existing bound
instance changed through Musubi to a 15-minute popup notification, then Off.
Both operations completed and native Google confirmed the selected settings;
siblings retained their original 10-minute notifications, with notes/time
unchanged. Native deletion and standard sync removed all active synthetic events
while preserving both completed journals. This covers stored reminder settings,
not notification firing, email reminders, physical devices or every instance
variant. Earlier fixture-only sections remain evidence of their original stage.
[Exact observations and cleanup](../audits/calendar-personal-series-live-acceptance-20260910.md).

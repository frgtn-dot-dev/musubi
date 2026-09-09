# Google existing-instance reminder preparation

The private native candidate targets an existing bound instance on the connected
account's own primary calendar. The default-off reminder flag blocks provider I/O.
No public capability or production activation is added by this candidate.

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
races, signal abort and caller mutation. Durable local parent/mapping/lease fences,
queue/worker/ACK, explicit conflicts and client acceptance remain separate work.
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
Generic worker, ACK and conflict replacement paths refuse this private journal;
the specialized worker/ACK and public composition remain follow-up work.

Disposable PostgreSQL regressions cover zoned/all-day moved slots, defaults/off/
custom intent, concurrent replay, stale parent and mapping, deleted/unlinked parent,
changed child revision/original identity, permission and lease loss, and generic
path isolation with zero provider I/O.

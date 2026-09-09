# Google existing-instance reminder preparation

The private native candidate targets an existing bound instance on the connected
account's own primary calendar. The default-off reminder flag blocks provider I/O.
No public capability, queue or production activation is added by this candidate.

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

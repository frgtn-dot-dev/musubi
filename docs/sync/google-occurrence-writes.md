# Google single-occurrence delivery

The existing default-off `EVENT_TIME_EDITS_ENABLED=false` gate now covers an
initial Google `occurrence` scope capability. The source must be the actor's own
connected Google calendar; every local family member must be linked only there.
This slice supports personal zoned or all-day series, editing one generated or
stored occurrence and cancelling one occurrence. Floating time, time-kind
conversion, URL edits, other providers, meeting attendees, special event types,
other linked calendars, and `following`/`series` provider scopes remain refused.
It does not activate production or send invitations.

Google's [instance identity](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
is `recurringEventId` plus `originalStartTime`, not the moved start or an ID
invented from a date. Preflight reads the accepted master and the paginated
[instances endpoint](https://developers.google.com/workspace/calendar/api/v3/reference/events/instances)
using the original start, verifies exactly one matching instance and its strong
ETag, calendar/OAuth write access, organizer self evidence and absence of meeting
attendees. Content and temporal evidence must match the local baseline.

The existing scope transaction rechecks local revision, membership, connection,
accepted master mapping and pending family delivery. It atomically commits the
local exception, master revision, native instance mapping, replay receipt and
one outbox update. No Google create or master rewrite is used for a generated
occurrence. Unsupported desired time models are rejected before preflight and
before the transaction commits. A same-operation replay returns its receipt
without another provider read; concurrent preparations still have one commit.

The worker rechecks provider evidence and sends an instance-only conditional
[PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
with `sendUpdates=none`. Active edits project title, description, location and
time; existing tentative status survives. Cancellation sends only `status`.
Unrelated reminders, availability, privacy and provider properties are omitted
from the patch. Recovery after a lost response reads and compares the desired
state before considering another PATCH. A 412 stays a conflict.

A baseline pull must not conflict with an already locally cancelled or moved
exception. Pending scope echoes compare the original identity and cancellation;
active echoes additionally compare temporal model and content. Cancellation-only
Google responses need not reproduce a formerly moved start or overridden title.
ACK locks the master before the child and checks the committed master revision.
Generic content conflict resolution refuses scope intents; dedicated scope
conflict resolution remains a follow-up requirement before activation.

`google_scope.integration.test.ts` exercises authenticated HTTP through
PostgreSQL and a local fake Google server: concurrent replay, generated update,
moved exception cancellation, baseline and in-flight echo pull, 503 reconciliation,
actual 412, timed move, all-day exclusive-end conversion, tentative preservation,
preflight/local CAS race, wrong occurrence identity, and refusal of floating time
and meetings. These tests do not replace live provider acceptance. This is one
K12 slice, not completion of all provider scopes or K13/K14.

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
Scope resolution uses a dedicated typed branch in the existing comparison flow.
It re-reads the same personal native instance and accepted master, shows the
original identity, cancellation and civil anchors, and requires the displayed
master revision as well as the local revision and fresh remote ETag. A missing
master confirmation (including older clients) is rejected. The transaction locks
the master before the child, rechecks destination/family identity, archives the
old intent and atomically appends one replacement retaining its native scope and
fresh baseline. It does not edit the saved draft or turn an instance into a create.
Concurrent confirmation/replay returns one operation. A completed replacement
releases the superseded history's family fence; another conflict requires another
fresh comparison. Provider master changes, absence/unreadable identity, meetings,
and unavailable permissions remain refused. Accepting the provider version as a
local replacement is not implemented by this apply-saved-version flow.

`google_scope.integration.test.ts` exercises authenticated HTTP through
PostgreSQL and a local fake Google server: concurrent replay, generated update,
moved exception cancellation, baseline and in-flight echo pull, 503 reconciliation,
actual 412, timed move, all-day exclusive-end conversion, tentative preservation,
preflight/local CAS race, wrong occurrence identity, and refusal of floating time
and meetings. These tests do not replace live provider acceptance. This is one
K12 slice, not completion of all provider scopes or K13/K14.

Resolution evidence additionally covers stale master/remote comparisons,
missing master confirmation, concurrent commit/replay, conflict cancellation of a
moved exception, and another scope edit after successful resolution. Web
1280-light/390-dark browser checks include keyboard focus/return and axe; the
native callback test confirms the displayed master revision and state. These are
local checks, not physical-device or live-provider acceptance.


## Whole-series evidence preparation

The default-off Google adapter can also read the accepted master and a complete,
unexpanded `events.list` traversal (`singleEvents=false`, `showDeleted=true`, no
time bounds). It retains only this master's native exceptions, including distant
cancellation-only definitions, validates personal permissions, strong ETags and
unique IDs/original starts, and checks the master again after pagination. Missing
master/list data, repeated page tokens, duplicate identities and more than 100
pages are refused. Unrelated calendar events do not become family evidence.

This is read-only preparation for K12 whole-series operations. It is not yet
called by the scope endpoint and does not authorize a series write. Sequential
provider reads are not an atomic snapshot: any future writer must revalidate its
family evidence and use conditional writes. The HTTP fixture covers zoned and
all-day families, moved and distant cancelled exceptions, pagination and refusal
paths, plus the existing single-occurrence write/recovery regressions.

# Google calendar access transitions

Google event sync stores the last locally accepted discovery access role and a
monotonic revision on the source link. Complete discovery reconciles that role
and the connected owner's Musubi membership under the calendar lifecycle lock.
An unchanged observation is a no-op. Any role change, including a return to a
previous role, increments the revision and clears the sync cursor atomically.
Initial observation of an existing mirror also requires a fresh full listing.

A fetch captures source ID, account, owner, native calendar address and access
revision before native I/O. Event upsert, deletion, full-set sweep and cursor
commit validate that context under the same lifecycle fence. A response from an
older access generation cannot modify a newly reconciled mirror or advance its
cursor. Successful full listing reconciles omitted mappings even when known-time
editing is disabled. Existing mapped event UUIDs remain stable when still present.

`reader`, `writerWithoutPrivateAccess` and unknown roles remain locally read-only.
This does not infer a write grant from calendar ownership. The stored revision
orders locally accepted discovery observations; it is not a Google ACL ETag or
proof that provider permission cannot change after a response.

## Evidence and remaining privacy work

`google_access.integration.test.ts` uses the actual Google adapter, a local HTTP
fixture and disposable PostgreSQL. Held native responses cover stale upsert,
delete, full sweep and empty delta cursor writes, including owner→limited→owner
ABA. Discovery regression covers an incomplete list, fresh full reconciliation,
free/busy exclusion and restoration.

On transition to a limited/unknown role, the transaction immediately replaces
provider-origin mapped event details with a Busy placeholder, clears personal
provider state and validators, and increments canonical revisions. It preserves
UUIDs, native addresses, time/recurrence meaning, links and private saved intents;
unmapped local drafts are not removed. Existing queued event-change emails for
those events are dropped. The committed change wakes source and linked-calendar
readers before any later event fetch can fail. Regaining a role alone does not
restore data: a fresh native observation is required, including for an unchanged
native ETag. A private mapping revision tracks redaction through a successful
limited read, so a later fuller same-ETag/same-state response cannot be skipped.
Restoration does not fan out provider writes. Later genuine native changes under
the same limited grant still propagate to linked writable destinations; retaining
a same-ETag recovery marker does not suppress them. Linked readers are notified again
when restored or partially restored data commits.

A sole pending personal Google reminder/RSVP operation can retain a private
recovery marker: accepted revision, immutable-intent hash, mapping identity and
redacted/restored revision. A fresh source-version-fenced read may restore the
canonical mirror while still retaining the pending native observation. It does
not retry or complete the old operation. Explicit resolution can adopt the fresh
read only within that marker's revision lineage and unchanged temporal identity;
its normal full native preflight, binding, permission and confirmation checks
remain mandatory. Payload, operation ID, accepted revision and uncertainty are
preserved. Separate local edits, changed mappings/intents or multiple pending
operations do not gain this exception.

One-off reminders now perform the same final live source/revision/lease check as
other personal writers immediately before PATCH, after all native preflight
reads. Tests pause both reads across downgrade/regain and retain uncertainty
without permitting the old write.

Web stream refresh includes calendar roles. Web/native provider detail instances
reset on canonical revision; web handed-off editors retire their old observation.
Four Chromium/mock scenarios cover open details/editor, light/wide and dark/narrow,
focus return and accessibility. PostgreSQL coverage includes failed reads, linked
reader deltas/SSE, preserved drafts/intents and fresh-only regain. Actual adapter/HTTP/DB cases cover reminder/RSVP, one-off/bound instances, zoned DST/all-day, explicit concurrent confirmation, local/mapping/time/intent changes and multiple-pending refusal.

Complete authoritative discovery also redacts mapped-origin details before removing
an absent/freeBusyReader source, in the same transaction as normal mirror removal.
Shared surviving tombstones retain identity and cancellation history without old
private details. The complete affected event set is locked before any subset;
previous source and linked readers receive invalidation after commit. Incomplete
calendar discovery does not remove mirrors.

Google delivery inbox titles now require the exact connected source and current
full native/local grant. After the first access generation, a successful sync cursor
is also required. Otherwise the public receipt says Calendar event while the saved
intent remains intact. Pre-discovery generation-zero links retain legacy full-grant
behavior; source replacement cannot authorize an old link's receipt.

Queued event-change notifications recheck current visibility, live event status,
Google source grant and fresh read evidence at dispatch. The check also covers
payloads inserted after transactional redaction cleanup. Each recipient's batch is
read again immediately before transport, and successful delivery only removes an
unchanged payload. This cannot revoke an email already handed to SMTP. Tests use
local PostgreSQL and an injected transport; no real email is sent.

This still does not close every privacy path. Broader free/busy modeling, full-editor
and generated-occurrence cache coverage, old clients and physical/native acceptance
require follow-up. No production writer flag, release version or client minimum
changes here.

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

This is the sync-ordering prerequisite for privacy downgrade/regain, not its
completion. A failed fresh fetch can still leave older details locally available.
Immediate content redaction/quarantine, public read and client cache invalidation,
notification history and restoration from fresh evidence require separate work.
Saved local intents are not discarded by the access-version transition. No
production writer flag, release version or client minimum changes here.

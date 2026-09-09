# Microsoft calendar private-read access

Microsoft calendar discovery requests `canEdit` and `canViewPrivateItems`
independently. `canEdit` controls the connected user's local write role; loss of
write permission alone does not imply loss of private-read permission. This does
not change Musubi sharing policy based on an event's `sensitivity` value.

The existing private source fields store the tri-state evidence as
`microsoft:private=yes|no|unknown;edit=yes|no|unknown` and an increasing local
`providerAccessRevision`. Missing native evidence is unknown. A changed observation
resets the cursor and forces a full native read. The revision orders local
observations; it is not an upstream ACL version.

A confirmed transition to `canViewPrivateItems=false` retires imported detail
before fetching events, including when that fetch subsequently fails. The
calendar lifecycle transaction clears title, notes, location, URL, organizer,
provider state and ETag, increments event revisions, and keeps stable event IDs,
time, recurrence identity and private durable intent. Canonical family children
are covered even when a cancelled child has no separate native mapping. Linked
readers receive invalidation, and queued detail notifications are purged.

Every ordinary import, delete and cursor commit verifies the captured source
identity and access generation. Canonical family replacement/removal verifies its
complete captured source context. An old response cannot commit across a
downgrade/regain cycle. Unknown proof cannot restore a retired row. A fresh,
fenced read with explicit false evidence may import whatever public or redacted
content Graph currently authorizes; false does not permanently disable imports.
A subsequent fresh true read can restore details even with the same native ETag.
Pending intents retain their existing conflict behavior and immutable payload;
Graph does not use Google's special personal-read recovery bypass.

Complete discovery removal redacts shared surviving tombstones before unlinking
the source and cancelling delivery. Failed or partial discovery does not infer
removal. Retained delivery titles and notification dispatch recheck the current
source/account, full private-read proof and fresh cursor. Graph write loss alone
does not hide a read-authorized receipt. Historical private intent never becomes
a public receipt title through a fresh limited read.

Web and native open editors retire provider-derived fields on redaction or
confirmed source removal, including generated occurrences and cached URL handoff.
A monotonic `providerReadRetiredRevision` survives limited/full reads, so coalesced responses need not expose the intermediate Busy row. It is optional for older clients and rejected in create/PATCH requests. Unmapped cancelled children keep the same evidence until their own authorized read. Mapping restoration markers do not depend on unrelated canonical revisions. Explicit field edits and explicit clears survive; accepted write revision remains
frozen. Graph viewer role alone does not erase authorized content.

Fake HTTP/database coverage includes failed/unknown reads, write-only loss,
same-ETag restoration, ordinary/family stale writes and deletes, cursor ABA,
retained intent, shared source removal, receipts and queued notifications.
Mounted client tests cover draft ownership and retirement. Live Microsoft shared
calendar changes and physical native acceptance remain separate verification;
no OAuth, feature flag or version change is part of this slice. Migration 0075 adds only nullable numeric retirement provenance.

Primary protocol reference: [Microsoft Graph calendar resource](https://learn.microsoft.com/en-us/graph/api/resources/calendar?view=graph-rest-1.0).

The combined RSVP regression exercises real access reconciliation between the
worker read and dispatch, after dispatch before acknowledgment, and a
true–false–true access change. Retirement prevents stale acknowledgment and
preserves the original private intent. An explicitly re-admitted Check response
is actually claimed and does not dispatch a second POST or restore old details.

# Explicit local adoption of a changed Graph creation

The existing default-off event time edit gate includes an owner-confirmed
**Use provider version** choice for an unresolved personal Graph series create.
This resolves the case where the original POST may have succeeded but the
provider family changed before unchanged-create recovery could acknowledge it.
The original create ACK still requires its saved content, time and footprint.

## Bounded candidate

A complete listing on the same current calendar must identify exactly one master
with the original transactionId. A fresh native read must prove a personal,
non-draft, non-cancelled, nonmeeting master with no exceptions/cancellations.
The current known zoned/all-day time and recurrence must round-trip through the
existing finite COUNT/UNTIL contract: 1–366 unambiguous slots within 730 days.
The complete finite family reader checks every plain occurrence and its original
identity. Another master read and repeated unique transaction discovery detect
changed observations. The current calendar must explicitly allow editing and the
connected owner must retain the required OAuth scope and local source rights.

Content, time and supported finite recurrence differences may be adopted.
Absence, duplicate transactions, meetings, noEnd/unsupported rules, incomplete
pages, exceptions/cancellations, retired native IDs or identity collisions are
refused. No absence permits another POST. Broader family adoption remains future
work, as do Graph organizer operations and recurring updates/deletes.

## Explicit choice and atomic local acceptance

The delivery comparison shows the saved local version and the observed provider
master. Its strict adoption request contains the operation context's local
revision, opaque snapshot version and a stable mutation identity. Confirmation
rereads the native candidate/family. The snapshot hash covers the complete
normalized family including IDs, UIDs, ETags, content, time and provider state,
plus the exact local/source/journal context. A stale comparison is refused.

The database transaction rechecks the isolated unresolved create, current event,
source/permissions/account, lack of mappings/children/newer history and lack of
a competing lease. Native identity/tombstone checks precede mapping adoption.
The existing complete-family persistence path installs the root and children,
updates canonical revisions and records provider state. Only then does the same
transaction retire the original row as `not-needed`, with a strict private
`graph-create-adoption` marker. The original event and native creation intent
remain byte-for-byte unchanged in its payload. No new outbox write is queued.

The calendar-wide pending-create import fence is released only by this commit.
Tracked family sync can subsequently reconcile the accepted identity. Exact
confirmation replay returns the receipt without provider IO; terminal retry and
original create replay cannot resurrect the old POST. The receipt says that the
provider version was accepted in Musubi, not that the original request was sent
or matched. A post-commit refresh invalidates the calendar view.

This is an explicit local snapshot choice. Graph does not offer atomic
whole-family reads or family compare-and-swap here; later provider edits remain
for subsequent sync. Adoption sends no Graph POST/PATCH/DELETE and makes no
organizer-delivery claim. Flags, versions and minimum client requirements remain
unchanged. The original regression evidence uses synthetic DB and fake HTTP/API
fixtures. A later bounded live run is recorded below.

## Evidence

The candidate transport test preserves strict unchanged-create recovery and
refuses absent/duplicate/meeting/noEnd/partial candidates without a write.
The synthetic integration suite covers authenticated preview/confirmation/replay,
COUNT/UNTIL/all-day families, concurrent acceptance, stale native snapshots,
source/account/role/revision/history/lease/flag races, tombstones, original payload
preservation, current creation receipt, tracked-family sync and terminal retries.
Web/native tests cover explicit confirmation and the stable request; browser
acceptance covers desktop/light and narrow/dark keyboard, accessibility, layout
and focus after the retired action disappears, including Cancel/Escape after a
committed adoption loses its HTTP response.

## Bounded live acceptance — 2026-09-11

[Live browser evidence](../audits/calendar-outlook-adoption-browser-acceptance-20260911.md)
covers actual Musubi all-day COUNT=3 admission, controlled response loss after a
real Graph 201, and explicit local adoption of a changed title on a normalized
personal UTC family, followed by stable sync and cleanup. The native Outlook
UI rename also changed time metadata and was refused; a separate QA-only PATCH
restored the supported time shape before the positive adoption. This does not
certify that native UI variant or broaden the strict adoption contract.

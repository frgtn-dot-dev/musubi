# Google all-day instance reminders — 2026-09-11

## Standard Musubi path

A guest-free primary-calendar all-day DAILY COUNT=3 fixture on September 24–26
had its September 25 middle occurrence materialized natively and imported by
standard account-scoped sync. This is fixture setup, not acceptance of Musubi
recurring creation. The accepted parent and child retain DATE original identity.
The development time/reminder flags were enabled with background sync disabled;
production flags and releases were unchanged.

The standard `queueGoogleReminders` service and exact receipt's
`deliverEventOutboxAndNotify` worker completed custom popup15 and Off. Frozen
operation UUIDs and requests were saved before admission. Full native family
comparisons excluded only ETag/updated bookkeeping, plus the target's requested
reminders. Master, siblings and all other target fields were unchanged, as were
canonical parent/child revisions.

Fresh native Google UI showed popup15 as “Den předtím v 23:45” on the all-day
September 25 occurrence; Off removed the reminder list. This confirms stored
settings, not actual notification firing or a fresh Musubi browser submission.
The expired Musubi browser session still needs renewed OAuth consent; existing
backend credentials and native Google sessions were used independently.

## Defaults mismatch

The next frozen request selected `useDefault:true`. Google returned
`useDefault:false` with popup10; the durable operation correctly became
`conflict` / `provider-conflict`. A fresh Google UI showed the resulting reminder
at 23:50 on the previous day. No matching inheritance flag was observed, so the
result is not accepted as calendar-default semantics. Other native fields,
master, siblings and canonical revisions were preserved.

A separate guest-free native-only all-day diagnostic on September 27–29 used
parent popup27, a materialized middle occurrence initially Off, and calendar
popup10 defaults. Both `{useDefault:true}` and the separate
`{useDefault:true,overrides:[]}` PATCH returned explicit popup10 with
`useDefault:false` in the mutation response, direct child GET and instances list.
This distinguishes the observed values from the parent's popup27. Full native
comparisons found no other changed fields. It does not prove future propagation
when calendar defaults change. The diagnostic master and target were cancelled
after capturing evidence. This native diagnostic is not another Musubi delivery
acceptance and did not retry the original conflicted operation.

Google's [reminders guide](https://developers.google.com/workspace/calendar/api/concepts/reminders)
describes setting `useDefault:true` to restore calendar defaults. The live
instance response above does not satisfy that requested state. Equal current
minutes cannot replace confirmation of the inheritance flag.

A separate timed native-only control used September 30–October 2,
16:00–16:30 Europe/Prague, with calendar popup10 and parent popup27. The PATCH
response contained `useDefault:true`, but direct GET and instances listing both
returned explicit popup27 with `useDefault:false`. A later independent read
returned the same result. The timed control preserved other native fields and
was cancelled after inspection. This demonstrates why a successful mutation
body alone is insufficient; it is not proof of a universal Google behavior.

## Restricted contract and regression

Bound Google instances retain custom and Off reminder writes. New requests to
restore calendar-default inheritance are refused before a provider mutation.
The one-off contract is unchanged. Historical exact `useDefault:true` evidence
can still confirm read-only, but explicit popup10/popup27 cannot substitute for
that evidence or authorize retrying the original intent.

Fake HTTP regressions cover DATE and zoned fixtures, strict historical
confirmation/recovery, defaults refusal with no PATCH, and continued custom/Off
writes. Native diagnostic calls above are not standard Musubi timed delivery
acceptance. The targeted transport suite passed.

All three native fixture series have been cancelled. Standard sync initially
refused to retire the original local master because its child defaults conflict
remained unresolved. A narrow retirement rule now handles an authoritative
Google master deletion only when every unresolved child intent is an unleased
conflict/blocked defaults request with exact actor, source, account, mapping,
parent, original-slot and revision bindings. It cancels that obsolete intent as
`source-deleted-unsupported-reminders`, preserves its payload and attempt history,
and allows normal family tombstones. Other pending work still blocks the
transaction; this is not a general discard or overwrite operation.

A live sync retry completed cleanup without another provider DELETE. No active
local fixture rows remained; custom and Off receipts remained `completed`, while
the defaults receipt became `cancelled` with the explicit source-deletion reason.
No failed request was marked completed or directly rewritten.

Validation passed: 106 targeted database scenarios across admission, delivery,
resolution and journal/retirement suites; shared draft and native editor tests;
600 web tests; eight browser/mock K14 scenarios; web/native typechecks and web
lint. Clean-context independent review found no remaining P0–P2 issues. The
browser scenarios establish the changed local UI behavior against mocked HTTP,
not a renewed live Musubi OAuth session. Full check and exact-head CI results
belong to the accompanying PR.
Physical devices, OS notification delivery, email reminders and production
activation remain outside this evidence.

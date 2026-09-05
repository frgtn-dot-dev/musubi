# Conditional EVENT delivery boundary (K06 integrated candidate)

This is **not whole-K06 acceptance or release readiness**: independent review and
parent acceptance remain required. Local CAS, wire/client revision contracts,
frozen drafts and truthful postcommit API responses are integrated. PRODUCT / MIN_CLIENT / MIN_PEER remain 0.1.8. Outlook existing mapped
EVENT update/delete remains refused in both preflight and the direct adapter:
its event-specific conditional enforcement is **unknown**, not proven unsupported.
Read/create and existing genuinely local unlink remain available. Tasks are not
EVENT concurrency evidence and their serializers are not changed by this work.

## Provider contract and evidence

- Google Calendar's [conditional modification guide](https://developers.google.com/workspace/calendar/api/guides/version-resources)
  documents exact resource `etag` in `If-Match` for update/delete and stale-version
  `412`. [Events PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
  preserves omitted fields; supplied arrays replace the entire array. A title
  edit sends only `{"summary":"…"}`. [Events DELETE](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)
  has no request body. Do not derive ETags from `updated`, sequence or local revision.
- CalDAV [RFC 4791 §§5.3.2–5.3.4](https://www.rfc-editor.org/rfc/rfc4791.html#section-5.3.2)
  requires strong resource ETags, conditional replacement, and support for unknown
  components/properties/parameters. [RFC 9110 §13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)
  requires strong comparison and forbids a fresh mutation on a false condition.
  Normally that is 412; HTTP permits acknowledgement of an already-applied change.
  This is a conforming-protocol contract, not certification of arbitrary servers.
- CalDAV uses complete guarded GET → selected property changes → complete PUT,
  **not** normalized-event → whole-ICS serialization, projected REPORT → PUT,
  PROPPATCH, or unconditional retries. GET's strong ETag must equal the mapping's
  previously accepted ETag. A newer read is a conflict, not permission to rebase.
  PUT uses that same GET representation/version. Partial responses and invalid
  UTF-8 are refused, never lossy-decoded and written back.
- `ical.js` selects/validates the unique master and encodes changed properties.
  `caldav_event_ical.ts` locates physical content-line spans only. All unrelated
  bytes, folded lines, property parameters, timezone definitions, alarms, unknown
  components, UID, and detached exceptions remain outside serialization. Unknown
  parameters on an edited single property are retained too. Ambiguous/malformed
  selection fails closed. DURATION is replaced by the intended DTEND when a time
  change would otherwise move the unchanged end implicitly.
- K04 restrictions remain: recurrence changes with detached CalDAV exceptions
  are refused; a legacy recurrence change without validated complete scope intent
  still requires possible-create permission. Whole-resource DELETE is whole-series
  deletion, not occurrence deletion. Organizer/collection/resource rights are
  still checked before local mutation.
- Missing/weak/invalid validators are refused, not trimmed, repaired, quoted,
  converted from weak tags, or replaced by `*`. EVENT create/update stores only
  an actual valid response ETag. Missing/weak/malformed update response versions
  become **null**, never the old ETag or a later GET's ETag. CalDAV transformations
  cannot return a strong PUT response ETag under §5.3.4; normal authoritative sync
  must accept their content and version before another write. Google create with
  no usable returned identity is unconfirmed, not an invented mapping.
- 412 never causes an unconditional fallback. Network failures and nonfinal 2xx
  acknowledgements (e.g. 202) remain unconfirmed. Redirects cannot turn a conditional
  mutation into apparent success via GET. Google event mutations refuse redirects;
  CalDAV keeps the installed SSRF/DNS-pinning/credential-stripping boundary.

Local HTTP fixtures prove **client request construction, refusal, preservation and
state transitions only**. No real provider accounts are used or provider-side
stale-write enforcement inferred from fake HTTP.

## Existing integration seams

`apps/api/src/sync/adapter.ts` and `engine.ts` extend the existing paths, not a new
parallel delivery framework:

1. `CalendarEventWrite` supplies `action`, full server event/context (Date values),
   `calendarIDs`, optional `previous`, optional **server-computed actual**
   `EventContentPatch`, and server-only `scopeEditValidated`. Patch values take
   precedence over the event context; undefined is omitted, null is an explicit
   clear. Only existing provider-writable fields (title, description, location,
   time/all-day, recurrence) are projected. Local-only modeled fields are not
   invented as provider fields.
2. `prepareEventWrites(writes)` clones each operation, resolves its account and
   mapping with the **local calendar scope**, and preflights the entire known
   set before returning a closure. It captures remote IDs, accepted validators
   and UID **before unlink can remove mappings**. Same remote IDs in different
   accounts/local calendars cannot select or update each other's mapping.
3. As a temporary legacy seam, absent `patch` is computed with `diffEventContent`
   only when an actual server-read `previous` is supplied. This is payload
   preservation, **not local CAS**. A mapped update with neither is refused with
   `event-diff-unavailable`; it is never interpreted as an empty diff or a safe
   full snapshot. The currently unused `pushEventToProviders` / `pushEventToCalendars`
   update convenience wrappers therefore cannot bypass this requirement.
4. `adapter.pushUpdate(userID, accountID, externalCalendarID, externalEventID,
   event, capturedRef, actualPatch)` receives the captured expected validator and
   actual diff. `pushDelete(..., capturedRef)` needs no mapping lookup at delivery.
   Only an explicit known empty/local-only patch can produce no provider write.
5. `deliver(onlyAction?, committedRevision?)` is request-scoped and intended for **sequential** calls.
   It returns `EventDeliveryReceipt[]`. Completed actions are not resent; the first
   failure is latched and rethrown on later calls, leaving later actions unattempted.
   Create/update mapping metadata is persisted through existing scoped DB helpers.
   Returned `void` from update means no write; `{etag:null}` means a successful
   write without a reusable validator and must clear the stored ETag.

### Stable internal errors and receipts

- Preflight preserves `EventWriteError` (capability denied/unknown/unsupported),
  `ProviderAuthError`, and `ProviderEventWriteError`. Unknown preflight exceptions
  remain conservative capability-unknown refusals before mutation.
- `ProviderEventWriteError` has `code`: `provider-conflict`,
  `provider-version-unavailable`, `event-diff-unavailable`, or `provider-write-failed`;
  `outcome`: `not-written` or `unconfirmed`; and optional `providerStatus` (412 for
  an actual conditional HTTP conflict). Accepted-vs-fresh conflicts have no HTTP
  412 because no mutation request was issued. None of these claims local rollback.
- A delivery failure throws `EventDeliveryError { receipts, failure }`, never gets
  logged and swallowed as success. Receipts retain action, event/local calendar,
  provider/account and external resource scope. Status is `not-attempted`,
  `completed` (including a known no-op), `not-needed` (no mapped remote target),
  `conflict`, `not-written`, or `unconfirmed`. Mapping persistence failure after
  HTTP success is conservatively unconfirmed; this is not a distributed transaction.
- These remain **internal**. The API publishes only action, status and reason,
  never internal account/resource IDs or raw provider errors to collaborators.

## Integrated API / CAS / client ordering

- Shared strict write schemas require positive `expectedRevision` on PATCH, the
  compatibility PUT alias, delete, unlink, link and fork. Creates start at server
  revision 1. Optional read revisions exist only for old caches, which cannot save.
  Scope metadata belongs to request envelopes, never Events, disk, providers or URLs.
- Handlers freshly authorize and preflight the entire known write intent, then use
  event-locked transactional CAS before calling conditional delivery. A stale local
  revision causes no local mutation and **zero remote mutations**, including no-ops.
  Omission preserves; supported explicit nullable null clears; actual no-ops do not
  advance revision or timestamp. Link changes and calendar cascades also advance
  revision under the same event-before-link/map lock order.
- Fork atomically guards the source revision and creates a fresh independent ID.
  It retains the established source-preserving endpoint behavior; there is no new
  implicit unlink/move operation. Existing source unlink/delete remains separately
  revision-guarded. Multi-request recurrence edits are not an atomic transaction.
- Prepared provider references survive local unlink. Response mapping writes are
  guarded by committed event revision and captured mapping identity/validator, so
  a delayed outbound acknowledgement cannot bless newer inbound content.
- Precommit conflicts return 409 / `localCommitted:false` and current row/revision.
  Conditional delivery failures return 409 (conflict) or 502 (unconfirmed), with
  `localCommitted:true`, current local row/revision and sanitized partial receipts.
  Local state is not falsely rolled back; notifications announce the local commit.
- Both clients capture the original occurrence, master, links and revision and
  submit only intended content changes. Web More-options authority uses a tab-local
  handoff, not URL metadata; a content-only URL without authority is nonwritable.
  Native save callbacks await success and return the actual scope boolean; Cancel
  does not call the API, change reminders or close. Delete also awaits success.
- Failed drafts retain their baseline and contents. Authoritative receipts refresh
  cache/reminders without replacing newer inbound rows or advancing the draft.
  Actual browser SSE invalidation and native SSE callbacks cross frozen composers
  in regressions. Access-loss removal frames carry a revision; if the source row
  has already been purged, native requests authoritative full reconciliation.
- PRODUCT / MIN_CLIENT / MIN_PEER stay 0.1.8, including member-token refusal and
  documented bootstrap exceptions. The wire snapshot is generated from the actual
  integrated request schemas. K01–K05 restrictions remain; K07 durable retry/outbox
  and K12 atomic scopes are explicitly absent. No live-provider certification,
  production migration, release or push is implied.

## Regression gates

`pnpm test:db:sync` includes
`apps/api/src/sync/adapters/provider_event_writes.integration.test.ts`: actual
adapters, authenticated Express handlers, scoped DB mappings and local HTTP.
It covers title-only Google payload; exact opaque validators; missing/weak/stale
versions; 412 and unconfirmed failures; same-scoped remote IDs; complete rich/folded
CalDAV preservation; missing/transformed write versions; malformed/partial reads;
ordinary nullable/time edits; recurrence boundaries; and delete refs after unlink.
`event_capabilities.integration.test.ts` retains K04 denied/unknown/Outlook refusal
and legacy/validated recurrence-intent coverage. `caldav.test.ts` and
`caldav_client.test.ts` cover existing task/serializer and guarded transport behavior.
Run DB gates only against a newly owned disposable test database.

`event_revision.integration.test.ts` adds authenticated HTTP/DB CAS races, stale
partial drafts, versionless refusal, nullable/no-op behavior, links/fork/cascades
and tombstones. Provider HTTP tests additionally force a local revision change
during preflight (zero remote effects), partial target failure after commit and
stale mapping acknowledgement refusal. Chromium K04/K05/K06 exercises concurrent
editors, SSE, More-options, overnight preservation and local/remote/network/auth/
version failures; native composer tests run actual host callbacks, transport,
store and SSE handling with only native hosts/network/cache boundaries mocked.

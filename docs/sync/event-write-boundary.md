# Conditional EVENT delivery boundary (K06 stage 1)

This is **not whole-K06 acceptance or release readiness**. Local CAS, wire/client
revision contracts, frozen drafts and truthful postcommit API responses still need
integration. PRODUCT / MIN_CLIENT / MIN_PEER remain 0.1.8. Outlook existing mapped
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
5. `deliver(onlyAction?)` is request-scoped and intended for **sequential** calls.
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
- These are **internal**, not a finished public response schema. Do not blindly
  serialize internal account/resource IDs or raw provider errors to collaborators.
  The API writer must authorize/sanitize the wire delivery summary.

## Required next integration (not implemented here)

- Require frozen expected local revision and actual request patch in shared wire,
  handlers and both clients. Wire CAS into all update/delete/link/unlink/fork/scope
  and relevant legacy DB writer paths. A stale local revision must cause **zero
  remote effects**, even if the submitted fields happen to look like a no-op.
- Keep known-write-set ACL/provider preflight **before local mutation**, then local
  CAS commit **before any conditional delivery**, including removed-copy/delete
  delivery. Current handlers still use unconditional legacy writers and perform
  delete delivery before local unlink/reconciliation. They are **not deployable**
  as complete K06. Prepared references now survive unlink to enable that reorder.
- `patchEventAndCalendarLinks` returns actual `patch`, before/after and link diff.
  Bind those results to the preflighted captured plan without re-reading/rebasing
  validators or doing fresh denial-capable preflight only after commit. The current
  closure clones its inputs at preparation; it does **not** silently replace its
  event/patch with later CAS results. The API/CAS writer must reconcile these seams
  (including unchanged-revision, mapping-only inbound races), not assume the stage-1
  legacy `previous` SELECT is atomic or that postcommit preparation preserves deletes.
- Existing `setExternalEventSyncData` persists scoped metadata but is not a mapping
  CAS against intervening imports/unlinks. Integrate its ordering/accepted-version
  checks with the actual local CAS flow; never use response-only metadata updates
  to bless unseen content. Missing-validator writes may require authoritative
  resync/refresh before further writes; no automatic unsafe retry is provided.
- Handler must catch delivery failure and return truthful `localCommitted`, current
  authoritative revision/state and sanitized partial/unconfirmed receipt. Today
  middleware returns generic **500**, including after locally committed updates;
  it does not yet expose 409/provider-conflict or a delivery receipt to clients.
  Existing client error rollback/draft/cache behavior is therefore **not UI-complete**.
  Preserve the original draft and newer inbound cache; do not report rollback or
  silently advance the draft baseline. Notifications/response sequencing on failed
  delivery also belongs to this next integration.
- Complete current no-op handling, frozen browser/native draft and full-editor
  handoff, revision-less cache refusal and final API/CAS/client/browser gates.
  Keep all K01–K05 authority/version/scope behavior, old-client/peer refusal and
  approved Outlook restriction. No K07 outbox/durable retry or K12 atomic scope
  promise is implied.

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

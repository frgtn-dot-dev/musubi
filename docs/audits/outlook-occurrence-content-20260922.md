# Outlook occurrence content editing — 2026-09-22

## Supported behavior

The web and native provider editor can change the title, notes and location of one stored Outlook occurrence, including an existing moved exception. This supports personal events and organizer-owned meetings in the verified default calendar. It preserves both provider-expanded imports and canonical tracked families without converting between them. Personal occurrences use “Save” and do not show invitation information.

The existing `PROVIDER_ORGANIZER_EDITS_ENABLED` flag remains required. The reader must prove a complete finite family (at most 366 slots within the existing 730-day bound and supported time zones). This does not enable series-wide content edits, rescheduling, recurrence changes, “this and following”, shared/delegated calendars, online meetings or target attachments.

## Safety and compatibility

- v3 (`outlookOrganizer=3`) opts into the new strict `organizerEdit.seriesVersion` occurrence proof. v1/v2 keep their existing response shape. Admission binds that proof, the local revision, provider state, exact mapping, account/default calendar identity and the complete native baseline.
- Only explicitly changed subject/body/location fields are sent. The PATCH addresses the selected native instance with its weak `If-Match` ETag. The original slot, UTC endpoints, authoring-zone metadata, guests and all untouched target properties are compared on readback. Full-family proof checks the master, siblings, exceptions and cancelled slots.
- Graph requires an explicit `originalStart` selection on the full target GET. A first edit materializes `occurrence` as `exception` and gives it a new technical `createdDateTime`; those two changes are accepted only for that transition. The family reader conservatively reports exception time as `legacy-unknown`; content completion preserves the existing local time model and still checks the native UTC endpoints and original slot.
- Text notes/location are trimmed consistently with ordinary Outlook imports. A title-only PATCH omits the body entirely and preserves existing HTML.
- The dedicated outbox intent is immutable. Calendar lifecycle admission fences import/reconciliation while an operation is unresolved. Local content and refreshed family mapping metadata commit atomically only after durable HTTP acceptance and matching readback. A no-op sends no PATCH.
- A permanent dispatch marker prevents re-sending an update after a lost reply, even when the native result looks correct. Retry checks only. Definite HTTP 412 or an undispatched rejection releases the fence without changing local content; accepted/ambiguous operations cannot use generic ACK, rebase or conflict resolution paths.

## Verification

Live evidence: [redacted report](evidence/outlook-occurrence-content-20260922.json). Two new disposable COUNT=3 series were exercised through real DB admission/outbox/Graph delivery: one personal and one meeting with the previously approved test guest. Each completed title, notes/location and explicit clear updates to the middle occurrence. Siblings, time, guests and untouched HTML stayed unchanged. A stale ETag PATCH returned 412 in both cases. Personal cleanup returned 204, meeting cancellation returned 202, native absence was verified, and local fixture rows/journals were removed. Guest notification receipt remains unknown.

Earlier disposable probes exposed the originalStart omission, text-normalization discrepancy and exception creation timestamp. A probe assertion also incorrectly inspected an empty HTML document as text; final clear assertions use Graph's text view. All probe families were removed; no existing user event was changed.

Database coverage includes flat/canonical, personal/meeting, all-day, moved target, existing moved/cancelled siblings, clear/no-op, stale admission/delivery, sibling/local/authority/account changes, partial reads, attachments/conferences, changed guest, HTTP 412, lost replies, process restart and durable acceptance recovery. Existing Outlook cancellation, one-off content and tracked-family/journal suites were also exercised.

Web/native editor tests cover exact occurrence request binding, content-only controls and frozen retry identity. Chromium covers light desktop/personal and narrow dark/meeting flows, keyboard focus return, accessibility, layer placement and overflow; related cancellation/one-off flows were also checked. Repository Playwright was used because no Browser skill was available. Physical native device testing was not performed in this stage.

No database migration, new dependency, release or production deployment is included.

Reference: [Microsoft Graph event update](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0) documents minimal PATCH payloads and preservation of omitted fields; conditional and materialization behavior above was verified against the connected test account.

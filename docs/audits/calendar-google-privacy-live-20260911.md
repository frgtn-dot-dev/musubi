# Google private-event access: live acceptance, 2026-09-11

## Scope

The owner explicitly approved switching one new disposable calendar between
free/busy, reader and full detail/edit access, including private details, between
their two Google accounts, followed by deletion. This resolves the approval
block recorded in the [availability run](calendar-google-availability-live-20260911.md).
No existing calendar ACL was changed. Production activation and device QA are
outside this acceptance.

The secondary account owned `Musubi QA privacy transitions 20260911`; the main
Musubi account subscribed. Its single synthetic private event was September 23,
10:00–11:00 Europe/Prague, with a title, location and description, no guests and
no native reminders. Native Google UI performed the ACL changes. Musubi ran on
the existing local development ports 3000/7531. CUA Playwright drove the in-app
browser; a read-only, fixture-scoped PostgreSQL helper compared identities,
revisions, field presence and hashed ETags without exporting account secrets.

## Live observations

| Transition / surface | Result |
| --- | --- |
| Initial full writer | One source and one canonical event; private title, place and note visible in Musubi. |
| Writer → reader | Source access revision advanced; event UUID stayed stable. Private title, place and description were removed. A fresh limited read returned the same hashed ETag as the full read. |
| Reader → writer | Fresh sync restored the original title, place and note without an event edit or changed ETag. Event UUID remained stable and canonical revision advanced. |
| Already-open detail, API-triggered reader downgrade | Original title/place/note disappeared without closing the detail; edit/delete and provider reminder-write actions disappeared. Regaining writer restored the detail and actions without reopening it. |
| Writer → writerWithoutPrivateAccess, already-open editor | Private fields were redacted in storage; editor became read-only. An explicitly typed `!` in the draft title was retained separately. |
| Limited writer → writer | Editor became editable again with the own draft suffix retained; native event was not saved or changed by that draft. |
| Writer → freeBusyReader, already-open untouched editor | Editor closed, normal source/mapping/canonical event disappeared. Discovery offered a new availability source, disabled until explicit selection. |
| Cleanup | The disposable calendar was deleted in Google; final discovery removed its availability source. All prior account connections remained. |

The initial backend-only sync ran in a separate helper process, which does not
share the API's in-memory SSE connections. Its stale browser view was not counted
as live notification evidence. The accepted open-detail/editor tests used the
normal authenticated refresh action in a second Musubi tab, keeping the first
tab's detail/editor open. A development API restart for the fix required browser
reload; pre-restart drafts were not claimed to survive that restart.

## Finding and fix

Google's limited private event response omitted summary and organizer. After
the immediate Busy redaction, normalization replaced that label with
`(untitled)`. No private details leaked, but the label misrepresented a hidden
event as an ordinary unnamed event.

Normalization now uses the access role from each fresh Events.list response.
Only explicit private items missing summary and organizer under `reader` or
`writerWithoutPrivateAccess` receive the Busy fallback. Full or unknown roles,
ordinary unnamed events, supplied/empty titles, cancellations, direct get/write
observations and hydrated masters retain their previous behavior. Per-page role
evidence is preserved across pagination and both time-model modes.

After restarting the local API, a fresh live writer → reader transition showed
Busy in the already-open detail and database, with location/description absent
and the same ETag hash. Writer regain then restored the full detail again.

Validation: new targeted normalization regressions and the existing API test
suite passed against an inert database URL. Independent clean-context review
found no actionable issue. Live database reads were separate from tests.

## Boundaries

This verifies one private, timed, one-off Google event on a secondary calendar.
It does not add permission to unsupported provider writes or validate physical
native devices, offline clients, queued-write races, all-day/recurring privacy
variants or linked surviving tombstones. The fixture had no other calendar
links, so full canonical removal on free/busy downgrade was the observed case.
Failed native reads and source-generation races retain their automated evidence.

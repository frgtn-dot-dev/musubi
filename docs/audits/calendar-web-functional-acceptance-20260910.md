# Web functional acceptance — 2026-09-10

Live browser walkthrough against the development web app and API, based on
`bc3ee08`, using a new local QA account and personal calendar in an isolated
database copied from the retained test environment. This is functional and
basic interaction evidence, not visual design approval or exhaustive UX QA.
Provider writers and scheduled sync remained disabled. No invitations were sent.

## Observed results

| Flow | Result |
| --- | --- |
| Registration | Mismatched passphrases show an error; correcting confirmation allows signup. |
| Onboarding | Name and local calendar creation succeed; skipping connections opens the calendar. |
| Timed event | Quick form preserves title when opening More options; title, location and notes save and survive reload. |
| Event editing | Renaming saves and appears in the agenda and search; closing an unsaved edit leaves the saved event unchanged. |
| Required title | Empty event title displays “Add an event title.” and keeps the form open. |
| Event deletion | Confirmation appears and deleting the QA event removes it from the agenda. |
| All-day event | Creation displays the correct date in agenda, month, day and week. |
| Local recurrence | Daily series renders separate occurrences. Editing This event changes only the selected occurrence and survives reload. |
| Recurrence deletion | Deleting This event removes only that occurrence; Undo restores it. |
| Following scope | Changing This and following events updates the selected and subsequent occurrences while preserving the earlier exception. |
| Tasks | Create, complete, reload with completed status, reopen editor with saved notes, and delete succeed. |
| First task creation | Found and fixed: Create → Task from a fresh month view previously navigated without opening the editor. The request now survives the first Tasks loading screen. |
| Task fix retest | Full reload on Month followed by Create → Task opens New task on the first attempt. Closing, switching to Month and returning to Tasks does not reopen the consumed request. |
| Search | Finds the renamed event in the loaded range and opens its detail. |
| Connections | iCloud form opens with app-specific-password guidance; unfinished deliveries opens with an explicit empty state. |
| Runtime | The final browser console check returned no errors or warnings. Default-viewport screenshot showed an operable calendar without a runtime overlay. |

## Fix and review

`CalendarScreen` now owns the task creation request above its loading gate.
`Workspace` keeps its local fallback for other callers. A regression test
unmounts/remounts the workspace during loading, then checks close and reopening.
Independent review of the three handwritten code/test files found no actionable
issues. Targeted Workspace/TaskList tests: 38 passed; web types and lint passed.
Full `pnpm check` passed, including 556 web tests, 327 native tests, standalone
self-check scripts, types, lint and build. The associated pull request is the
source of truth for subsequent exact-head CI and merge status.

## Limits and remaining acceptance

No live Google, Outlook or iCloud roundtrip, invitation/RSVP, OS notification,
physical native-client or DST-axis acceptance is claimed by this walkthrough.
Google OAuth configuration must be restored locally after the temporary secret
configuration was lost across the environment restart. The retained provider
accounts alone do not demonstrate a working OAuth refresh or write permission.

The compact editor currently discards unsaved edits when explicitly closed;
this was observed, not changed into a new draft-retention UX contract. Visual
polish and deeper UX review remain with the owner as requested.

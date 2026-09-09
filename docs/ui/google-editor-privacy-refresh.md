# Google editor privacy refresh

A Google source access downgrade refreshes calendar roles and canonical event
rows through `external_sync`. Editors retain a write baseline so ordinary remote
updates do not overwrite a user's draft. That baseline must not retain copied
provider content after a privacy refresh.

The compact editor and full editor now lift current form values into their
owning component. At an advanced canonical revision, Google viewer access marks
a privacy boundary. The cleared Busy shape also handles a batched downgrade and
upgrade whose intermediate viewer role never rendered. The boundary replaces
unchanged title, description, location, and URL fields with the canonical values;
changed fields remain the user's draft. Authored-field ownership persists across
successive privacy refreshes, including explicit clears and values that happen
to equal a later provider baseline. Compact-to-full handoffs preserve empty
authored values; legacy marked fields with omitted values also mean an explicit
clear. Organizer and color in the frozen
baseline are refreshed too. Occurrence geometry and the original write revision
stay frozen, so this read refresh does not grant a new write authorization.

Read-only editors hide fields and keep those authored field changes while the
editor stays open. Role restoration alone remounts from the sanitized baseline.
Closing the editor retains the existing discard/focus-return behavior. Normal
revision updates and local calendar drafts keep their existing behavior.

Full-editor handoffs are marked after a privacy refresh. Copied URL fields are
removed with a replacement navigation, so replaying a sanitized handoff cannot
restore them. `draftFields` records which URL content fields were explicitly
changed during the compact-to-full handoff. On reload into a restricted Google
source, unmarked legacy URL snapshots are discarded. A settled missing event
also clears the handoff and copied URL values; a pending or failed query does
not establish removal. Changes retained in memory survive a temporary missing
result without bringing back the old provider baseline.

This is a client projection boundary, not a new server permission or private
recovery metadata field. Changed text fields are preserved as whole authored
fields, matching the event editor's existing mutation model. Previously created
URLs without authored-field provenance cannot distinguish typed content from a
copied provider snapshot after reload and therefore fail closed for restricted
Google events.

Validation:

- `pnpm --filter @musubi/web typecheck`
- `pnpm --filter @musubi/web test -- src/calendar/components/EventEditorPrivacy.test.tsx src/calendar/components/EventEditorForm.test.tsx src/calendar/event-editor-search.test.ts`
- `PLAYWRIGHT_ORIGIN=http://127.0.0.1:45318 pnpm --filter @musubi/web test:e2e -- e2e/month-read.spec.ts --grep 'Google editor privacy refresh' --workers=1`

Browser cases use mocked reads and stream frames for compact one-off, generated
occurrence, and full editors. They check downgrade/regain, preserved typed
content, removed copied content, URL cleanup, read-only accessibility, console
errors, and desktop/light plus narrow/dark screenshots. No provider writes are
performed. The repository Playwright path is used because the Browser plugin
is unavailable.

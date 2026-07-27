# Musubi Web

TanStack Start web client for the Musubi monorepo. Express remains the owner of
`/api/*`; this app owns the authenticated web shell and future public web
surfaces.

## Local commands

```bash
pnpm --filter @musubi/web dev
pnpm --filter @musubi/web typecheck
pnpm --filter @musubi/web test
pnpm --filter @musubi/web lint
pnpm --filter @musubi/web build
pnpm --filter @musubi/web start
```

The browser uses relative `/api/*` URLs. Vite proxies those requests to the
local Express API on port 7531; production keeps the same paths on one origin.

## Current boundary

The authenticated Month, Day, Week and Agenda routes read the canonical Express
calendars, events, settings and pages contracts through TanStack Query and
validate them with `@musubi/types`. The sidebar lists the user's real Pages and
the workspace route resolves the `default` sentinel (and any stale id) to the
canonical default Page, keeping the current view and date. Event quick create,
edit and delete use the existing Express write endpoints, wait for confirmed
server responses and gate controls through the shared calendar permissions. The
Calendars dialog manages native calendars — create, rename, recolor and delete —
gated by the shared `can()` roles (external/provider calendars stay read-only
here), alongside the existing .ics import/export. A per-calendar Share dialog
lists members, lets owners change roles (viewer/editor), transfer ownership
(confirmed; hidden for personal/provider calendars) or remove members, creates
and revokes invite links (`<origin>/invite/<token>`), and lets a non-owner
leave. The sidebar profile opens an Account dialog to change the display name
and photo (Better Auth `updateUser` plus the avatar upload endpoint), request a
password reset email, and start the email-confirmed account deletion, gated
behind typing the display name. A Connections dialog lists
synced accounts (grouped from the calendars list), disconnects or reconnects
them, and adds new ones — Google/Outlook via Better Auth `linkSocial` with
calendar scopes, Apple/CalDAV via a credentials form — gated by the server's
advertised `syncProviders`. Calendars shared from another Musubi server are read
through the home federation gateway (ADR-005), so the browser never holds a
cross-server member token: the sidebar and views merge them like any other
calendar, the Connections dialog lists each server with a reachable/unreachable
badge and can disconnect it, and one unreachable server degrades to a status row
instead of taking the workspace down. Writes and management follow the calendar:
event create/edit/delete, attendance, members, roles, invites, rename and export
are routed to the server that owns the calendar (`federation-routing.ts`), and
because each origin only knows its own calendars, an event may not span two
servers — the editor refuses that combination;
fixture data remains test-only. Pages have an explicit editor: entering edit
mode drafts the page name and calendar visibility locally, a sticky save bar
persists them through `PATCH /api/v1/pages/:id` (compare-and-swap), and a
revision conflict offers "save as a copy" instead of a silent overwrite.
Switching pages or reloading with unsaved edits warns first; `Ctrl/Cmd+S`
saves. View and filter editing is not wired into the draft yet.

A same-origin `EventSource` on `/api/stream` keeps sessions in sync: `page_*`
events upsert or remove pages in the query cache (deduped by revision), and the
other realtime events invalidate the settings, calendars and event queries.
Because the editor freezes its base revision when editing starts, a page changed
in another session while you edit produces a save conflict instead of a silent
overwrite.

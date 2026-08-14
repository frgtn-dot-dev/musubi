# UI catalogue

Every page, layer and toolbar state of `apps/web`, in both themes. Generated —
mark them up freely, they are rebuilt from scratch each run.

```
cd apps/web
UI_SHOTS=../ui-catalog pnpm exec playwright test -g "ui catalogue|onboarding once"
UI_SHOTS=../ui-catalog UI_SHOTS_THEME=dark pnpm exec playwright test -g "ui catalogue|onboarding once"
```

The source is the `ui catalogue` test in `apps/web/e2e/month-read.spec.ts`, which
skips itself unless `UI_SHOTS` is set. It runs against the same mocked server the
rest of the suite uses, so the data in the shots is the suite's fixture calendar
(Europe/Prague, clock pinned to 3 August 2026).

| # | What | Where it lives |
| --- | --- | --- |
| 01 | Sign in | `routes/login.tsx` |
| 02 | Find a time — public builder | `routes/find-a-time.tsx` |
| 03 | Find a time — identity step, with the draft read back | `components/EmailIdentity.tsx` |
| 04 | Make an event page — public | `routes/new-event.tsx` |
| 05 | Calendar invitation | `routes/invite.$token.tsx` |
| 06 | Published event page | `routes/e.$token.tsx` |
| 07 | Poll — the answer grid | `routes/s.$token.tsx` |
| 08 | Poll — one cell's answer menu | `routes/s.$token.tsx` |
| 09 | Poll — link no longer valid | `ui/RouteState.tsx` |
| 10–13 | Month, Week, Day, Agenda | `MonthCalendar`, `TimeGridView`, `AgendaView` |
| 14 | Event preview | `calendar/components/EventDetailsPopover.tsx` |
| 15 | Quick create | `calendar/components/QuickCreate.tsx` |
| 16 | Settings | `calendar/components/SettingsDialog.tsx` |
| 17 | Calendars | `calendar/components/CalendarTransferDialog.tsx` |
| 18 | Connections | `calendar/components/ConnectionsDialog.tsx` |
| 19 | Find a time (in-app) | `calendar/components/SchedulingDialog.tsx` |
| 20 | Poll answers, still open | `components/PollGrid.tsx` |
| 21 | Poll once decided | `calendar/components/SchedulingDialog.tsx` |
| 22 | Account | `calendar/components/AccountDialog.tsx` |
| 23 | New page | `calendar/components/PageSettingsDialog.tsx` |
| 24 | Page settings | `calendar/components/PageSettingsDialog.tsx` |
| 25 | Filter bar open | `calendar/components/Workspace.tsx` |
| 26 | Search, with its match count | `calendar/components/Toolbar.tsx` |
| 27 | Keyboard shortcuts | `calendar/components/ShortcutsDialog.tsx` |
| 28 | Full event editor | `routes/app/p.$pageId.event.new.tsx` |
| 29 | Share event | `calendar/components/ShareEventDialog.tsx` |
| 30 | Share a calendar, with the invite-link limits | `calendar/components/ShareCalendarDialog.tsx` |
| 31 | Delete a calendar — confirmation | `ui/ConfirmationDialog.tsx` |
| 32 | "This event or the series?" | `calendar/components/RecurrenceScopeDialog.tsx` |
| 33 | Toast, with its undo | `ui/Toast.tsx` |
| 34 | A write the server refused | `calendar/components/EventDetailsPopover.tsx` |
| 35–37 | Nothing yet: month, agenda, polls | `ui/Empty.tsx`, `AgendaView`, `SchedulingDialog` |
| 38–39 | Phone width: month, navigation drawer | `Workspace`, `Sidebar` |
| 40–42 | First run, three steps | `onboarding/Onboarding.tsx` |

Numbers 01–39 are generated in order by the `ui catalogue` test; 40–42 are written
by hand in the onboarding test, which needs an account that has never seen the
app and so cannot run inside the catalogue.

Not in here yet, and worth asking for if you want them: the offline and stale
banners (the offline shot needs a clock the catalogue has pinned), multi-week
(still hidden behind the registry), and the calendar-transfer picker that "Link"
and "Copy" open from an event.

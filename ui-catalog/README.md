# UI catalogue

Every page, layer and toolbar state of `apps/web`, in both themes. Generated —
mark them up freely, they are rebuilt from scratch each run.

```
cd apps/web
UI_SHOTS=../ui-catalog pnpm exec playwright test \
  -g "ui catalogue|onboarding once"
UI_SHOTS=../ui-catalog UI_SHOTS_THEME=dark pnpm exec playwright test \
  -g "ui catalogue|onboarding once"
```

The source is the `ui catalogue` test in `apps/web/e2e/month-read.spec.ts`, which
skips itself unless `UI_SHOTS` is set. It runs against the same mocked server the
rest of the suite uses, so the data in the shots is the suite's fixture calendar
(Europe/Prague, clock pinned to 3 August 2026).

| # | What | Where it lives |
| --- | --- | --- |
| 01 | Sign in | `routes/login.tsx` |
| 02 | Calendar invitation | `routes/invite.$token.tsx` |
| 03–06 | Month, Week, Day, Agenda | `MonthCalendar`, `TimeGridView`, `AgendaView` |
| 07 | Event preview | `calendar/components/EventDetailsPopover.tsx` |
| 08 | Quick create | `calendar/components/QuickCreate.tsx` |
| 09 | Settings | `calendar/components/SettingsDialog.tsx` |
| 10 | Calendars | `calendar/components/CalendarTransferDialog.tsx` |
| 11 | Connections | `calendar/components/ConnectionsDialog.tsx` |
| 12 | Account | `calendar/components/AccountDialog.tsx` |
| 13 | New page | `calendar/components/PageSettingsDialog.tsx` |
| 14 | Page settings | `calendar/components/PageSettingsDialog.tsx` |
| 15 | Search, with its match count | `calendar/components/Toolbar.tsx` |
| 16 | Keyboard shortcuts | `calendar/components/ShortcutsDialog.tsx` |
| 17 | Full event editor | `routes/app/p.$pageId.event.new.tsx` |
| 18 | Share a calendar, with the invite-link limits | `calendar/components/ShareCalendarDialog.tsx` |
| 19 | Delete a calendar — confirmation | `ui/ConfirmationDialog.tsx` |
| 20 | "This event or the series?" | `calendar/components/RecurrenceScopeDialog.tsx` |
| 21 | Toast, with its undo | `ui/Toast.tsx` |
| 22 | A write the server refused | `calendar/components/EventDetailsPopover.tsx` |
| 23 | Empty month | `ui/Empty.tsx` |
| 24–25 | Phone width: month, navigation drawer | `Workspace`, `Sidebar` |
| 26 | Offline snapshot | `offline/SnapshotProvider.tsx` |
| 27–29 | First run, three steps | `onboarding/Onboarding.tsx` |

Numbers 01–26 are generated in order by the `ui catalogue` test; 27–29 are written
by hand in the onboarding test, which needs an account that has never seen the
app and so cannot run inside the catalogue.

Not in here yet, and worth asking for if you want them: the stale-data banner,
multi-week (still hidden behind the registry), and the calendar-transfer picker
that "Link" and "Copy" open from an event.

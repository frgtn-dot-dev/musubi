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
| 03 | Find a time — identity step | `components/EmailIdentity.tsx` |
| 04 | Make an event page — public | `routes/new-event.tsx` |
| 05 | Calendar invitation | `routes/invite.$token.tsx` |
| 06 | Published event page | `routes/e.$token.tsx` |
| 07 | Poll — the answer grid | `routes/s.$token.tsx` |
| 08 | Poll — one cell's answer menu | `routes/s.$token.tsx` |
| 09 | Poll — link no longer valid | `ui/RouteState.tsx` |
| 10–13 | Month, Week, Day, Agenda | `calendar/components/*Calendar*`, `TimeGridView`, `AgendaView` |
| 14 | Event preview | `calendar/components/EventDetailsPopover.tsx` |
| 15 | Quick create | `calendar/components/QuickCreate.tsx` |
| 16 | Settings | `calendar/components/SettingsDialog.tsx` |
| 17 | Calendars | `calendar/components/CalendarTransferDialog.tsx` |
| 18 | Connections | `calendar/components/ConnectionsDialog.tsx` |
| 19 | Find a time (in-app) | `calendar/components/SchedulingDialog.tsx` |
| 20 | Account | `calendar/components/AccountDialog.tsx` |
| 21 | New page | `calendar/components/PageSettingsDialog.tsx` |
| 22 | Page settings | `calendar/components/PageSettingsDialog.tsx` |
| 23 | Filter bar open | `calendar/components/Workspace.tsx` |
| 24 | Search | `calendar/components/Toolbar.tsx` |
| 25 | Keyboard shortcuts | `calendar/components/ShortcutsDialog.tsx` |
| 26 | Full event editor | `routes/app/p.$pageId.event.new.tsx` |
| 27 | Share event | `calendar/components/ShareEventDialog.tsx` |
| 28–29 | Phone width: month, navigation drawer | `Workspace`, `Sidebar` |
| 30–32 | First run, three steps | `onboarding/Onboarding.tsx` |

Not in here yet, and worth asking for if you want them: share a calendar,
recurrence scope ("this event or the series?"), the confirmation dialogs, the
offline and stale banners, and multi-week (still hidden behind the registry).

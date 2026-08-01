# Key page dependency trees

Generated from the real codebase on 2026-08-01. Trees focus on rendered local
components and the state/services that determine visible states. Utility imports
are noted where they materially affect interaction.

## Web — login

```text
routes/login.tsx
├─ ui/AuthShell
│  ├─ AuthBrand
│  ├─ AuthPanel
│  └─ AuthFooter
├─ ui/Field
├─ ui/RouteState
├─ calendar/components/ThemeToggle
└─ auth/auth-client
```

Implemented stories cover sign-in, pending submission, server error, narrow,
light, and dark states. Extract only auth compositions; Field and Button remain
primitives.

## Web — calendar Page

```text
routes/app/p.$pageId.$view.tsx
├─ components/WorkspaceDataState
├─ calendar/components/Workspace
│  ├─ Toolbar
│  ├─ Sidebar
│  ├─ Day/Week/Month/Agenda view renderers
│  ├─ filter shelf and Page controls
│  ├─ event preview/editor layers
│  └─ shared dialogs and Toast
├─ calendar/workspace-queries
├─ calendar/event-mutations
├─ calendar/page-editor
├─ calendar/calendar-transfers
├─ calendar/settings-mutations
├─ api/realtime + api/online-status
└─ auth/auth-client
```

Page settings now has deterministic regular, narrow, discard-confirmation, and
delete-confirmation stories. Remaining candidates are the chrome shell, each
view, empty/loading/error shell, narrow toolbar, and sidebar. Do not mock the
entire product before component-level stories are stable.

## Web — create event

```text
routes/app/p.$pageId.event.new.tsx
├─ calendar/components/EventEditorPage
├─ calendar/components/EventEditorForm
│  ├─ ui/Field
│  ├─ ui/DatePicker + TimePicker
│  ├─ ui/Select / Segmented / Switch
│  └─ ui/Button
├─ components/WorkspaceDataState
├─ calendar/workspace-queries
└─ calendar/event-mutations
```

Candidate stories: minimal timed event, all-day event, recurrence, validation,
small viewport. The full route is an integration story; field groups are
patterns.

## Web — edit event

```text
routes/app/p.$pageId.event.$eventId.tsx
├─ calendar/components/EventEditorPage
├─ calendar/components/EventEditorForm
├─ components/WorkspaceDataState
├─ calendar/workspace-queries
└─ calendar/event-mutations
```

Candidate stories: own event, read-only external event, recurring event and
missing event. Reuse the same editor stories rather than cloning markup.

## Native — main calendar

```text
app/(tabs)/index.tsx
├─ calendar/CalendarHeader
├─ calendar/CalendarFilterBar
├─ calendar/CalendarDrillView
│  ├─ cal/MonthView
│  └─ cal/TimelineView
├─ calendar/AddEventModal
├─ calendar/CalendarWidgetSettingsModal
├─ stores: events, calendars, settings, detail composer, imports
├─ hooks/useRefreshData
└─ ui/Toast
```

Candidate stories: header/filter composition, month and timeline fixtures,
draft gesture states, add-event sheet states. Modal shell is a high-priority
native extraction target.

## Native — agenda

```text
app/(tabs)/agenda.tsx
├─ calendar/CalendarFilterBar
├─ calendar/YearStamp
├─ calendar/AddEventModal
├─ ui/Tap
├─ ui/Empty
├─ ui/Toast
├─ stores: events, calendars, settings, detail
└─ hooks/useRefreshData + useCurrentDay
```

Candidate stories: grouped days, today/tomorrow labels, location and marks,
empty range, long content and refresh state.

## Native — calendars

```text
app/(tabs)/calendars.tsx
├─ calendar/ReorderableCalendarList
├─ calendar/CalendarDetailModal
├─ calendar/CreateCalendarModal
├─ calendar/SyncCalendarModal
├─ ui/Btn + ui/Empty + ui/Toast
├─ stores: calendars, events, settings
└─ hooks/useRefreshData
```

Candidate stories: grouped list, external provider states, reorder, empty state.
The repeated modal sheets should converge on one native shell before broad
screen stories.

## Native — settings

```text
app/(tabs)/settings.tsx
├─ SettingRowAction / SettingRowOptions / SettingRowToggle
├─ TextInputModal
├─ Avatar
├─ ui/Btn + ui/Tap + ui/Toast
├─ contexts/ServerContext
├─ store/useSettingsStore
└─ hooks/useRefreshData
```

Candidate stories: each SettingRow contract first, then account/appearance/help
section compositions and destructive account actions.

## Native — welcome

```text
app/(auth)/welcome.tsx
├─ ui/Btn
├─ TextInputModal
├─ contexts/ServerContext
└─ network error mapping
```

Candidate stories: default server, custom server dialog, connecting and error.

## Native — onboarding profile

```text
app/onboarding/index.tsx
├─ OnboardingScaffold
├─ Avatar
├─ ui/Btn + ui/Tap + ui/Toast
├─ contexts/ServerContext
├─ services/api
└─ avatar picker + haptics
```

Candidate stories: empty profile, selected avatar, validation and saving.
Scaffold is reusable within onboarding, not a global application layout.

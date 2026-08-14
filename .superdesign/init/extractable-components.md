# Extractable component assessment

Generated from the real codebase on 2026-08-01. Priority reflects duplication,
interaction risk and usefulness in Storybook—not file size alone.

## Reuse as-is before extraction

| Component | Current owner | Decision |
|---|---|---|
| Button / IconButton | web `src/ui` | Stable primitive with catalogued variants and states. |
| Avatar | web `src/ui` | Stable decorative identity mark with catalogued sizes. |
| AuthShell / AuthForm / AuthMessage | web `src/ui` | Stable authentication composition; keep server and account logic in the route. |
| RouteState | web `src/ui` | Stable full-page loading, unavailable, and error feedback composition. |
| Dialog / DialogClose | web `src/ui` | Stable shell with regular and sheet states in the catalog. |
| ConfirmationDialog | web `src/ui` | Stable confirm pattern used across production decision flows. |
| Popover / PopoverContent | web `src/ui` | Stable physical anchored-layer shell used by pickers and calendar feature layers; keep consumer semantics and focus behavior separate. |
| Menu / MenuContent / MenuItem | web `src/ui` | Stable command-list contract; no production consumer exists yet, so do not invent a one-item menu. |
| Field | web `src/ui` | Stable label/description/error contract with catalogued states. |
| Row variants | web `src/ui` | Stable settings/list pattern with catalogued variants. |
| Segmented, Switch, Checkbox, Select | web `src/ui` | Stable keyboard/state contracts covered in stories. |
| Toast | web `src/ui` | Stable action/no-action and neutral/error feedback contract. |
| Btn / Tap / Empty / Toast | native `components/ui` | Existing base; do not wrap in a universal React component. |
| SettingRow variants | native `components` | Move only after API and stories are stable. |

## High priority extraction

### Native modal shell

Repeated across AddEvent, CalendarDetail, CalendarPicker, CalendarSettings,
CalendarWidgetSettings, CreateCalendar, EventDetail, Invites, MemberRoles and
SyncCalendar. Extract platform-native primitives for overlay, sheet, handle,
header, scroll body and footer while preserving each feature's content and
keyboard/gesture behavior.

### Canonical design tokens

Web CSS and native TypeScript manually encode equivalent surfaces, text roles,
borders, accent, typography and radii. Create a renderer-free token source and
generate/import platform representations. Do not introduce runtime React
cross-platform branching.

### Feedback contract

Web and native both expose toast concepts. Share state semantics and copy rules
(success, error, Undo), but keep DOM live-region positioning and native portal/
animation implementations separate.

## Medium priority patterns

- Recurrence scope confirmation: keep its multi-choice business flow separate
  from the implemented two-action `ConfirmationDialog` pattern.
- Settings section: SectionLabel plus row variants and loading/error feedback.
- Picker field: labeled trigger, current value, clear/error and platform layer.
- Identity row: Avatar, primary/secondary text and trailing action.
- Empty/data state: icon, title, explanation and optional recovery action.
- Filter pill shelf: same visibility semantics in Page settings and calendar UI.

Patterns are compositions, not new styling systems. Their APIs must describe
user intent and allow realistic domain content.

## Keep feature-owned

- Time grid, month grid, agenda grouping and overlap geometry.
- Event preview content and recurrence business rules.
- Page-specific drag/reorder state machines.
- Provider connection and calendar transfer flows.
- OnboardingScaffold outside the onboarding flow.

These may contain smaller extractable primitives, but the composition is bound
to domain behavior and should not be forced into a generic package.

## Migration order

1. Add stories around current web primitives without moving imports.
2. Fix only contract gaps exposed by those stories.
3. Extract canonical tokens with parity tests.
4. Build native modal primitives and migrate one low-risk modal first.
5. Establish `ui-web` and `ui-native` packages only after public APIs settle.
6. Add screen-level stories with deterministic fixtures and composed catalogs.

## Rejection tests

Do not extract when the proposed component:

- needs a feature noun in its generic API;
- has only visual similarity but different interaction semantics;
- requires `isWeb` branches throughout the implementation;
- accepts arbitrary style props instead of a small variant contract;
- would duplicate an existing primitive during migration;
- cannot demonstrate at least Overview, Variants and States with real content.

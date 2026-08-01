# Extractable component assessment

Generated from the real codebase on 2026-08-01. Priority reflects duplication,
interaction risk and usefulness in Storybook—not file size alone.

## Reuse as-is before extraction

| Component | Current owner | Decision |
|---|---|---|
| Button / IconButton | web `src/ui` | Stable primitive; add stories in place first. |
| Dialog / DialogClose | web `src/ui` | Stable shell; document desktop/sheet states. |
| ConfirmationDialog | web `src/ui` | Stable confirm pattern; four production flows migrated. |
| Popover / PopoverContent | web `src/ui` | Stable physical anchored-layer shell; keep consumer semantics and focus behavior separate. |
| Field | web `src/ui` | Stable label/description/error contract. |
| Row variants | web `src/ui` | Stable settings/list pattern. |
| Segmented, Switch, Checkbox, Select | web `src/ui` | Stabilize keyboard/state matrix in stories. |
| Toast | web `src/ui` | Preserve action/no-action layout as two states. |
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

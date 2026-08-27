# Web UI consolidation plan

- Status: **active plan; P1.1, P1.4 and the visually-hidden item are done**
- Scope: `apps/web`
- Excluded: Scheduler, polls, `find-a-time`, `SchedulingDialog`, `Poll*`, poll CSS
- Previous restructure:
  [`ui-restructure-handoff.md`](./ui-restructure-handoff.md) is complete; do not
  reopen it as a redesign.

Read before implementation:

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`../../.agents/skills/musubi-ui/SKILL.md`](../../.agents/skills/musubi-ui/SKILL.md)
3. [`design-system.md`](./design-system.md)
4. Relevant behavior rules in [`calendar-ui.md`](./calendar-ui.md)

## Goal

Remove proven duplication around existing web primitives without changing
Musubi's visual direction. Prefer composition, standard DOM props, stable
`data-slot` hooks, and CSS custom properties over screen-specific variants or
one prop per visual adjustment.

This is consolidation, not a component rewrite. No external UI dependency, new
component package, generic card system, or broad restyle is needed.

## Working rules

- Reuse `apps/web/src/ui` before adding markup or CSS.
- Keep domain controls domain-owned. Calendar events, recurrence choices,
  palette choices, cover choices, and calendar geometry are not generic rows or
  buttons merely because they use `<button>`.
- A shared component API describes role or state, not pixels.
- Use semantic variants for meaning, slots for structure, `data-slot` for
  targeted styling, and CSS custom properties for genuine geometry exceptions.
- Do not add a screen-named variant such as `size="shareDialog"`.
- Preserve current appearance unless a visual change is explicitly approved.
- For a new public pattern or substantial visual change, prepare its Storybook
  state first and obtain approval before production migration.
- Migrate at least two real consumers when extracting a new shared pattern. An
  exception is a missing accessibility or shell-ownership contract.
- Keep each work item independently reviewable and green.

## Execution order

### P0 — Use primitives that already exist

No new shared API should be needed for these changes.

- [x] Replace hand-built search result buttons in
  `calendar/components/SearchDialog.tsx` with `RowAction`; use `SectionLabel`
  for result groups. Preserve command-search keyboard behavior and focus.

  `SectionLabel` replaced the group headings and `.results h2` went with it —
  the two rules were identical. **`RowAction` did not happen**, and the result
  button stays domain-owned. Measured against `RowAction size="compact"`:

  | | `.result` | `RowAction` compact |
  | --- | --- | --- |
  | padding | 8px / 12px | 4px / 8px |
  | label | 16px, `--text-primary` | 13px, `--text-secondary` |
  | trailing `small` | 11px | unstyled, 13.3px |
  | icon | full opacity | `--text-muted` |
  | hover | `--surface-raised` | 55% of it |

  Six properties, so it is a restyle rather than a swap. It also has a
  functional edge: `.result` draws its focus ring inward at
  `outline-offset: -2px` because the results list scrolls, and `.rowAction` has
  no focus rule of its own — the inward ring exists only as
  `.settingsSectionRows .rowAction:focus-visible`. Under the global
  `:focus-visible` at `+3px` the first and last result could clip their ring.
  Give `.rowAction` its own inward ring before reopening this; it belongs with
  the row anatomy work in P1.2.

- [x] Replace the icon-only agenda removal button in
  `calendar/components/EventPageSettings.tsx` with `IconButton`.

  It was a fixed 34×34 target, below the minimum on touch; `size="compact"`
  scales to 38px regular and 44px touch. The local accent-coloured hover is
  gone deliberately: `.button_ghost:hover:not(:disabled)` outranks a feature
  override, and one hover treatment across every ghost icon button is worth
  more than a per-button signal the trash glyph already carries.

- [x] Re-evaluate the quiet back action in `routes/new-event.tsx` against
  `Button variant="ghost"`. Change it only if markup and appearance remain
  equivalent; otherwise leave it domain-owned.

  **Left domain-owned.** `.back` is an underlined 12px text link with no
  padding and no control height. `Button variant="ghost"` is a 44px control
  with `--space-4` inline padding, 13px, weight 500, no underline. Different
  affordance, not different pixels.

Done when obsolete feature CSS is removed and existing interaction tests still
cover the same behavior.

### P1 — Complete missing primitive contracts

#### 1. Inline errors

Current error callout anatomy is repeated in account, calendar, connection,
event-detail, recurrence, settings, and sharing styles. A near-equivalent
`DialogError` already lives inside `ConfirmationDialog`.

- [x] Move or expose the existing alert shell as a general `InlineError` in
  `apps/web/src/ui`.
- [x] Keep `role="alert"`, optional request ID, standard HTML props, and
  `className` support.
- [x] Migrate matching dialog errors, then delete duplicate border, background,
  type, and spacing rules.
- [x] Add Storybook coverage for plain message, request ID, long message, and
  narrow layout.

Twelve call sites now compose `InlineError`; the four surviving feature classes
carry margin only. Two of them were not a restyle: `settings.module.css` and
`event-details.module.css` painted their text with the raw accent, which axe
measured at 3.82:1 on the tinted background against the 4.5:1 WCAG AA
threshold. `recurrence-scope.module.css` had dropped the shared background with
no reason recorded in the code or reachable through history, and its `error`
prop made callers assemble the alert markup; it now takes the message and
request ID that every other call site already had.

`page-settings.module.css` keeps `.conflict` local. It is a notice with an icon
and a `strong` line, closer to `ConfirmationNotice` than to this callout, and
one instance does not prove a pattern.

Do not add size or screen variants. Consumer layout belongs in `className`;
alert anatomy belongs to the shared component.

#### 2. Row anatomy and row groups

`Row` already owns useful content slots, but consumers cannot target its
internal anatomy without brittle descendant selectors.

- [ ] Add stable `data-slot` hooks for icon, copy, label, detail, value, and
  trailing content. Do not add styling props for each slot.
- [ ] Migrate `ShareCalendarDialog` member rows to `Row` once its current
  identity/actions layout can be expressed through those hooks.
- [ ] Extract a small `RowGroup` only while migrating at least two identical
  bordered list shells. It may own surface, border, radius, clipping, and row
  dividers; it must not own feature headings or business state.
- [ ] Keep `SettingsSection` as the canonical titled settings composition; do
  not duplicate it with another settings-specific wrapper.

#### 3. Field and picker wiring

**Closed: the premise does not hold.** No consumer wants `Field` around a
picker, and the two pickers would not survive it looking alike.

Measured by putting both inside a `Field` and reading computed style:

| Control                     | Border | Background        | Font | Height |
| --------------------------- | ------ | ----------------- | ---- | ------ |
| plain `<input>`             | 1px    | `--surface-raised`| 14px | 44px   |
| `DatePicker` trigger        | 1px    | `--surface-raised`| 14px | 44px   |
| `TimePicker` input          | 0      | transparent       | 12px | auto   |

`DatePicker`'s trigger is a `<button>`, so `.fieldControl > :is(input, select,
textarea, button)` claims it at specificity 0,1,1 against
`.datePickerTrigger`'s 0,1,0 and it comes out identical to a text field.
`TimePicker`'s root is the `<div>` that `PopoverAnchor` needs, which that
selector never matches. Inside one form they would diverge.

The consumers say the same thing:

- `EventEditorForm` composes pickers into `.pickerRow` — icon, label, control —
  and marks the label `aria-hidden` because the picker's `aria-label` already
  carries the name.
- All four `ColorPicker` call sites render it bare beside a `Field`, as a
  compact swatch with no visible label at all.
- `routes/new-event.tsx` was the only candidate, and what it actually needed was
  its picker labels marked `aria-hidden`, matching `EventEditorForm`. Screen
  readers were announcing each one twice. That is fixed.

Forwarding `id`, `aria-describedby` and `aria-invalid` to the triggers was
written and reverted: with no consumer it is public API nobody calls.

Reopen this only as a deliberate visual pattern — pickers rendered as standard
fields — which needs a stable control-root contract in that `:is()` list and an
answer for 12px against 14px and 38px against 44px. That is a design change
behind the approval gate, not consolidation.

#### 4. Dialog safe-area ownership

Several feature styles add bottom safe-area padding because dialog bodies lack
a footer.

- [x] Make `Dialog` own the final bottom inset whether or not a footer exists.
- [x] Remove feature-level safe-area compensation from migrated dialogs.
- [x] Verify footer/no-footer, padded/flush, regular/touch combinations in
  Storybook before production migration.

The count was wrong in both directions. Of 22 production dialogs, 12 have no
footer: four paid the inset by hand, and seven paid it nowhere, so their content
sat under the home indicator. Two more paid it twice — `PageSettingsDialog`
always renders a footer, yet its form added the inset again on a narrow
viewport, and the `EventDetailsPopover` action bar added it inside an
`AnchoredSurface` sheet that had already paid.

`Dialog` now writes `data-has-footer`, and the shell pays the inset where
nothing else does. A `--layer-safe-bottom` token stands in front of
`env(safe-area-inset-bottom)`, which cannot be assigned: without it no story
can tell a notch from a laptop, and the two new `Dialog` stories would prove
nothing. `routes/app.module.css` keeps its raw `env()` — it is a four-sided
shorthand alongside the other insets.

### P2 — Extract only proven repeated patterns

These are valid candidates, but each extraction must remove duplicate consumer
code in the same change.

- [x] Expose the existing visually-hidden recipe through one tiny shared helper
  or public class and remove identical local copies.

  There were thirteen copies, not the handful this item assumed, and
  `primitives.module.css` already held the canonical one. Eleven rules now
  compose it and `.srOnly` is gone as a second name for it. Two stay out:
  `poll-grid.module.css` is out of scope, and
  `event-editor.module.css` keeps the recipe inline because `composes` only
  works on a rule whose selector is a single class and that one is compound.

  The canonical rule sits at the top of its file on purpose — same-file
  `composes` cannot look forward. `Select`'s sheet title composes it and is
  un-hidden again below 600px, which now has a story that fails if the hidden
  recipe ever wins there.
- [ ] Extract the duplicated readonly copy-link control used by
  `ShareEventDialog` and `routes/new-event.tsx` as a small `CopyField` only if
  label, value, copy action, and feedback share one contract.
- [ ] Consolidate the repeated interactive attendee facepile as `AvatarStack`
  or a calendar feature component. Keep it outside `apps/web/src/ui` if its
  behavior remains attendee-specific.
- [ ] Inventory passive status/role/count chips. Add a shared badge only when at
  least two consumers share semantics and anatomy, not merely rounded CSS.
- [ ] Remove `routes/login.tsx` imports of private `primitives.module.css` rules
  by exposing the missing semantic composition through `AuthShell`.

### P3 — API cleanup after migrations

Do not start these as isolated refactors. Perform them only when an earlier
migration proves the need.

- [ ] Before adding another `Dialog` size variant, express exceptional width or
  max-height through documented CSS custom properties while retaining compact,
  default, and wide semantic presets.
- [ ] Review arbitrary numeric `Avatar` sizes after all consumers are visible.
  Prefer a small named scale; retain an escape hatch only for real optical
  exceptions.
- [ ] Delete compatibility selectors, dead feature CSS, and obsolete exports
  created by completed migrations.

## Explicitly deferred

- Universal `Card` component. Similar borders and radii do not prove shared
  semantics; current event, invite, and preview cards may remain feature-owned.
- Universal section header beyond `SectionLabel` and `SettingsSection`.
- Prop-per-pixel APIs for padding, radius, gaps, icon width, or control layout.
- Moving web primitives into `packages/ui-web`; extraction waits for stable APIs
  and proven cross-app value.
- Scheduler and polling UI.

## Verification per work item

Run the smallest relevant checks, then expand for public primitives:

```bash
pnpm --filter @musubi/web typecheck
pnpm --filter @musubi/web lint
pnpm --filter @musubi/web test
```

When changing a public primitive or story:

```bash
pnpm storybook:web:test
```

Also run the relevant Playwright flow when interaction, focus, dialog behavior,
or form submission changes. Check light/dark and regular/touch layouts. Do not
update `ui-catalog` unless the visual change was approved.

## Completion criteria

- Existing generic controls are reused where they fit; domain controls remain
  domain-owned.
- Repeated error, row-group, field, safe-area, copy-link, and hidden-text CSS is
  either consolidated or explicitly left local with a recorded reason.
- No new UI dependency or parallel component system exists.
- No new screen-specific appearance variant exists.
- Public contract changes have realistic stories and accessibility coverage.
- Keyboard paths, focus return, light/dark themes, and narrow layouts remain
  correct.
- This checklist reflects completed work and any deliberate deferrals.

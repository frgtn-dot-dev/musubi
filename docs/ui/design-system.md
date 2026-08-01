# Musubi design system

- Status: living document, foundation phase
- Date: 2026-08-01
- Applies to: `apps/web`, `apps/client`, and new shared design packages
- Domain source of truth: [`calendar-ui.md`](./calendar-ui.md)

This document defines **how we compose and maintain UI**. `calendar-ui.md`
continues to define **how the calendar behaves**. When rules conflict,
correctness, accessibility, and domain behavior take precedence over visual
uniformity.

## 1. Direction

Musubi is not a skin for another calendar application. Its identity is sumi ink
on washi paper, muted pigments, Inter Tight for working UI, Noto Serif for
orientation and meaningful emphasis, and calm geometry without extra decoration.

The design evolves rather than resets: preserve the recognizable character and
make hierarchy, rhythm, states, and consistency more precise. Superdesign is the
safe place to explore variants; Storybook is the catalog of components that are
actually implemented.

## 2. Architecture

Share meaning, not renderers:

```text
packages/design-system/  canonical tokens, names, and contracts without React
packages/ui-web/         DOM/Radix implementation and web idioms
packages/ui-native/      React Native implementation and native idioms
apps/web/.storybook/     web catalog and integration stories
apps/client/.storybook/  mobile catalog through React Native Web
apps/client/.rnstorybook/ device/simulator fidelity checks
```

These packages will be introduced incrementally. Until a component can be
safely separated from its application, it stays in `apps/web/src/ui` or
`apps/client/components/ui` and receives a colocated story. Do not create a
parallel replacement solely to satisfy a new directory structure.

### System layers

1. **Primitive tokens** — raw pigment, dimension, and timing values.
2. **Semantic tokens** — surface, text, border, action, feedback, and motion.
3. **Component contracts** — roles, sizes, states, and component anatomy.
4. **Patterns** — confirmation, forms, settings lists, selection, and feedback.
5. **Features** — calendar, agenda, Pages, sharing, and accounts.

A feature may own domain content and its layout. It must not own a new generic
button, field, menu, modal, popover, sheet, or toast.

## 3. Tokens

`packages/design-system` is the canonical renderer-free source for shared
semantic theme values. Web consumes its generated CSS custom properties;
native maps the same roles to its current theme aliases. The committed CSS is
checked against the TypeScript source in the package test, so changing a theme
value requires running `pnpm --filter @musubi/design-system generate`.

Theme colors and stable typography, dimension, and motion foundations are the
extracted slices today. They share renderer-free values where their units and
optical roles are explicit. Name a new value by role before adding it; a
hardcoded color, gap, radius, or motion duration inside a component needs an
explicit reason.

`packages/design-system` exports numeric `typeSizes`, `spacing`, `radii`,
`controlHeights`, `componentDimensions`, and platform-tuned `motionDurations`.
Web serializes them to rem, px, and ms in the generated `foundations.css`;
native consumes the same numbers as density-independent values. The package
self-check compares both generated CSS files with their TypeScript sources.

The shared boundary is intentional:

- type sizes are shared, while loaded font resource names and fallback stacks
  remain renderer adapters;
- spacing and general component radii are shared, while calendar geometry and
  one-off optical offsets remain feature-owned;
- control and row contracts are shared by density, while sidebar, tab, and grid
  measurements keep their platform or domain owner;
- motion shares `fast`, `standard`, and `slow` roles, with 140/220/300 ms on web
  and 160/260/320 ms on native. Gesture-following and press-in timings remain
  local because they respond directly to a finger rather than staged UI state.

- A primitive token does not say where it is used (`shu-600`, `space-4`).
- A semantic token communicates purpose (`text-secondary`, `surface-raised`).
- A component token exists only for a stable exception (`dialog-inline-padding`).
- Responsive values use one ladder: 599 / 1023 / 1439 px.
- Web px and native dp may differ, but the role and optical result should match.

## 4. Geometry and rhythm

Spacing expresses relationships. It is not selected independently for each
screen. Use the existing 4 px ladder through the following roles:

| Relationship | Value | Use |
|---|---:|---|
| Adjacent | 4 px | title to description, label to supporting text |
| Related | 8 px | icon to label, actions in one group |
| Control group | 12 px | tightly related controls or choices |
| Component inset | 16 px | compact cards, menus, and repeated rows |
| Field group | 20 px | one complete field to the next |
| Layer inset | 24 px | dialog header, body, and footer on regular viewports |
| Section break | 32 px | distinct content groups inside one view |

Do not substitute a nearby step because it looks acceptable in isolation. If a
relationship repeatedly needs a different value, name the component exception
and document why it cannot use the shared role.

### Responsive density

Layer interiors have two densities. Calendar breakpoints at 1023 and 1439 px
may change application architecture, but do not silently change the internal
rhythm of a dialog, popover, or menu.

| Contract | Regular, ≥600 px | Touch, ≤599 px |
|---|---:|---:|
| Minimum viewport gutter around a modal | 24 px | sheet is edge-to-edge |
| Dialog/sheet inline inset | 24 px | 20 px |
| Dialog body block inset | 20 px | 20 px |
| Dialog footer block inset | 16 px | 16 px + safe area |
| Default control height | 44 px | 48 px |
| Compact control height | 38 px | 44 px minimum target |

Touch density adapts anatomy rather than shrinking regular UI. Dialogs become
bottom sheets, actions wrap or stack when labels no longer fit, and safe-area
insets belong to the outermost region.

### Layer anatomy

- A layer shell owns its viewport gutter, width, radius, elevation, and region
  insets. Feature content must not compensate with negative margins.
- Header, padded body, and footer share one inline axis. The default dialog body
  is padded; edge-to-edge rows or sections require an explicit `flush` body
  variant, and their readable content still aligns to the same axis.
- Nested components own only their internal rhythm. A `Field` inside a padded
  dialog must not add a second outer inset.
- Whitespace establishes regions first. Header and footer separators are used
  only when a scrolling body or repeated rows need a persistent boundary; a
  short dialog must not become three bordered slabs.
- A regular dialog footer keeps actions right-aligned, secondary before primary,
  with an 8 px gap. Touch layouts preserve action order and stack only when the
  labels or minimum targets do not fit.
- Compact, default, and wide dialogs target 400, 520, and 720 px respectively,
  always constrained by the viewport gutter. Text measure remains bounded even
  in a wide dialog.

### Form composition

- Label to control uses 8 px; control to help or error text uses 4 px.
- Complete fields are separated by 20 px; distinct field sections by 32 px.
- A field does not receive a divider merely because it is a field. Dividers
  belong to repeated row collections and true region boundaries.
- Validation stays with the field that caused it and must not change the outer
  alignment of the form.
- A form uses one control height per density unless a multiline or domain
  control has an explicit semantic size.

### Settings composition

`SettingsSection` is the canonical scan unit for related preferences. Its title
and group edge follow the layer axis (24 px regular, 20 px touch), the title sits
8 px above the group, and separate sections use the 32 px section break. The
group uses the panel surface, a subtle border, and the 14 px shared radius with
no gradient or shadow. Rows retain their own 16 px component inset inside that
edge; this is nested component rhythm, not a competing layer axis.

Only repeated rows receive dividers. The group clips its surface and dividers,
while row focus rings draw inward so keyboard focus is never hidden by the
rounded edge. This inset structure was chosen over a fully flush list because
the stronger grouping makes long settings dialogs substantially easier to scan.

### Ownership test

When two edges do not align, fix the component that owns the shared axis. Do
not patch the consumer. In particular, a dialog header at 24 px, a field at
16 px, and a footer at 20 px are three competing systems, not visual nuance.

## 5. Components and layers

A component belongs in the shared layer when it has a stable general role, is
repeated or clearly part of the common language, and can be described without a
feature name. A one-off domain composition remains with its feature.

Dialog, sheet, popover, menu, and toast are not one component:

| Layer | Use | Behavior |
|---|---|---|
| Dialog | consequential decision or longer editing | modality, focus trap, explicit ending |
| Sheet | narrow viewport or native detail | modality, thumb reachability |
| Popover | local lightweight action or preview | anchored, preserves context |
| Menu | short command list | keyboard navigation, immediate choice |
| Toast | feedback after an action | non-blocking, optionally one Undo action |

They may share surfaces, headers, spacing, and motion, but their interaction
contracts stay distinct. Every portaled layer follows R4b and R4c from
`calendar-ui.md`.

Production modal flows import the shared `Dialog` contract; only that primitive
imports Radix Dialog directly. General anchored layers compose `Popover`,
`PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, and `PopoverClose`; only
that shared primitive owns their portal, collision gutter, surface, arrow,
motion, and narrow bottom-sheet geometry. Consumers retain their role, focus
policy, keyboard model, dimensions, and content anatomy. `Select`,
`DatePicker`, `TimePicker`, and `ColorPicker` use this contract without being
forced into one selection behavior. Calendar feature popovers keep their
special drag and focus policies while they are migrated as a separate bounded
step. Menus use their own command-navigation contract rather than turning
`Popover` into a universal interaction component.

`Menu` is that non-modal command-navigation contract. Radix Dropdown Menu owns
menu-button semantics, roving focus, arrow navigation, typeahead, Escape
dismissal, and focus return. `MenuContent` requires one accessible label, stays
anchored on regular viewports, and becomes an edge-to-edge command sheet at 599
px and below. `MenuItem` owns icon, label, optional shortcut, disabled state,
and a named destructive tone; `MenuSeparator` divides a genuinely different
command group. Do not use a menu for one action, persistent choices, form
controls, or navigation that should remain visible.

`Dialog` defaults to `bodyLayout="padded"`; use `bodyLayout="flush"` only for
edge-to-edge rows or sections whose own readable content follows the layer
axis. `Field` defaults to `variant="plain"`; `variant="section"` explicitly
adds the inset and divider needed inside a flush collection. Combining a
padded dialog body with a section field is a double-inset contract violation.

`ConfirmationDialog` composes the compact `Dialog` contract for one
consequential decision. It owns Cancel-before-confirm action order, loading and
disabled behavior, and safe initial focus on Cancel. A typed confirmation may
move initial focus to its required field. `ConfirmationNotice` owns the
consequence callout and `DialogError` owns alert semantics plus an optional
request ID; features provide only the domain copy, icon, and operation.

`SettingsSection` owns the heading, inset group surface, layer alignment, and
spacing between settings groups. `Row` owns item content and interaction;
`RowAction` exposes named `selected` and `tone="destructive"` states rather than
requiring feature-owned data attributes. Features provide only domain copy and
callbacks.

`Button` has four semantic variants. `primary` is the single strongest action
in a region, `secondary` supports or cancels it, `ghost` is a quiet toolbar or
inline action, and `destructive` is reserved for an action whose consequence
needs explicit emphasis. Do not show two primary actions in one action group or
use destructive styling as a generic brand accent. Dialog footers place the
secondary action before the primary or destructive ending.

The default `control` size matches form controls; `compact` belongs to dense
toolbars, toast actions, and other bounded chrome. Both sizes grow to the shared
minimum touch targets at 599 px and below. Labels are concise and remain on one
line; action groups stack rather than wrapping a button label. Loading blocks a
second activation, exposes `aria-busy`, and keeps the button's existing geometry
and accessible name stable.

`IconButton` uses the same variants and sizes but requires a `label`. Use it only
when the glyph is established in the surrounding product context; the label is
the accessible name and supplies the native tooltip fallback unless a custom
`title` is provided. Toggle icon buttons expose `aria-pressed`, while buttons
that open a layer expose the expanded state supplied by that layer primitive.

`Toast` is a single transient notice, never a stack or activity log. A new
notice replaces the current one. Neutral feedback uses a polite `status`; an
error uses an assertive `alert`, a visible error icon, and the error border tone
so color is not its only signal. Keep messages concise and self-contained. A
persistent failure, multiple recovery choices, or content that requires reading
belongs inline or in a dialog instead.

The optional action is one object containing its label and callback, so a silent
or inert half-action cannot render. It is reserved for Undo; generic navigation
and multi-step recovery do not belong in a toast. The message owns the live
region and the action is its sibling, keeping interactive content out of the
announcement. Toasts never take focus, and their timer is owned by the feature:
plain acknowledgements remain for 3.5 seconds while Undo remains for 9 seconds.

The region is centered on its owning content area. Message-only toasts keep
symmetrical inline padding; Undo toasts use the compact action inset without
changing the region midpoint. Both use the same maximum width and remain within
a 12 px viewport gutter on touch layouts. Feature code may move the region above
persistent chrome through the documented `--toast-left` and `--toast-bottom`
variables, but must not alter the toast's internal geometry.

`Segmented` is a visible radio choice for two to four short, mutually exclusive
options. It defaults to `size="compact"`; `size="control"` matches a regular
form control. Options share the available width, stay on one line, and may
compress their inline inset on touch viewports, but their labels must remain
readable. If real labels cannot fit at 320 px without truncation, use `Select`
instead of adding horizontal scrolling or wrapping the segmented control.

Selection follows focus: arrows wrap and skip disabled options, while Home and
End choose the first and last enabled option. A disabled group disables every
radio. Choosing the already-selected option only restores focus and does not
emit a duplicate change.

Every public component has:

- named variants instead of screen-specific CSS overrides;
- default, hover, focus-visible, pressed/selected, disabled, and pending/error
  states where they apply;
- an accessible name, keyboard path, and correct focus return;
- an API that describes role (`variant="destructive"`), not appearance
  (`red=true`).

## 6. Storybook contract

Stories are colocated with their components (`Component.stories.tsx`). The
catalog is grouped by role: `Foundations`, `Primitives`, `Patterns`, `Calendar`,
and `Screens`.

Minimum coverage for a public component:

1. `Overview` — recommended use with realistic content;
2. `Variants` — all supported variants side by side;
3. `States` — disabled, pending, error, selected, and long content as relevant;
4. `Narrow` — only when the component changes anatomy or layer;
5. interaction test — only for meaningful behavior, not pixel details.

Light and dark themes use the same stories. The accessibility panel must have no
known critical violation. Add screenshot tests only after the base components
stabilize; Storybook does not replace unit or end-to-end tests for domain
behavior.

The current web catalog uses Storybook 10.5 with the first-party TanStack React
framework. Run it from the repository root with `pnpm storybook:web`; build the
static catalog with `pnpm storybook:web:build`; run all story smoke, interaction,
and accessibility tests in Chromium with `pnpm storybook:web:test`. Storybook
tests use a dedicated Vitest 4 browser project, while the existing web unit suite
remains isolated in its jsdom project. Accessibility violations are test
failures, not an informational baseline. The Chromatic visual testing addon is
registered for reviewed visual baselines; publishing snapshots still requires
an explicitly configured Chromatic project and token.

Chromatic captures one default baseline for every story. Additional modes are
reserved for high-value visual contracts rather than multiplied across the
entire catalog: foundations, button variants, open dialogs and sheets, open
selection layers, and all toast anatomies. The shared modes pin the theme,
color scheme, locale, viewport, and touch capability. Chromatic also requests
reduced motion and pauses remaining animations before capture.

A visual contract for a portaled layer must use a `play` interaction to open
the layer and wait until its entrance state is visibly complete. The same story
therefore verifies interaction and accessibility before Chromatic captures it;
a snapshot of only the closed trigger is not coverage for a dialog, sheet, or
popover. Open-layer testing is required because hidden content is not included
in the normal accessibility pass.

Run a cloud build with `pnpm chromatic:web` and provide
`CHROMATIC_PROJECT_TOKEN` through the environment. CI reads the same value
from the GitHub Actions secret; forks and repositories without the secret skip
publishing without exposing credentials. The committed project ID created by
the Visual Tests panel is public metadata, but the project token must never be
written to source, configuration, logs, or documentation.

The baseline catalog visualizes the implemented color, typography, spacing,
shape, motion, and responsive contracts. It also covers Button, Checkbox,
ColorPicker, ConfirmationDialog, DatePicker, Dialog, Empty, Field, Row,
Menu, Popover, SectionLabel, Segmented, Select, SettingsSection, Switch,
TimePicker, and Toast without forking their production implementations. Muted
and faint color tokens may be shown as decorative swatches, but must not be
presented as readable text when they do not satisfy the required contrast
ratio.

## 7. Workflow

1. Check the existing primitive and the rules in `calendar-ui.md`.
2. If a general contract is missing, design it in Storybook with real content.
3. For a substantial visual change, reproduce the current state in Superdesign
   first, then compare variants; implementation starts after direction approval.
4. Implement one component or pattern and migrate a bounded set of consumers.
5. Verify typecheck, lint, unit tests, Storybook build, and relevant a11y checks.
6. Update this document when a change introduces a new rule.

## 8. Definition of Done

- No second implementation of existing general-purpose UI was introduced.
- A domain component does not own a generic shell.
- Values read from tokens and the component works in light and dark themes.
- Padded regions share their documented axis; flush content is explicit.
- Spacing describes one of the relationships in section 4 or a named exception.
- The state and responsive matrix is visible in stories.
- The core workflow is keyboard operable; color is not the only signal.
- APIs and stories use realistic Musubi content, not `Lorem ipsum`.
- The change does not violate R1–R12 or the checklist in `calendar-ui.md`.

## 9. Anti-patterns

- copying Radix dialog markup into a feature component;
- naming a general component after one screen;
- adding one prop per CSS property instead of a constrained variant set;
- using different names for the same role on web and mobile;
- a central stories directory detached from component source;
- a universal cross-platform React component full of `isWeb` branches;
- presenting a Superdesign draft as implemented truth;
- adding a token without a role or a magic number without a named constant.
- applying different inline padding to a layer header, body, and footer;
- removing shell padding in a story and rebuilding it inside feature content;
- using dividers to compensate for weak spacing hierarchy.
- opening a menu for a single command instead of invoking that command directly;

## 10. Adoption order

1. Document the inventory and current system. *(Complete.)*
2. Run Storybook around existing web primitives without moving them. *(Complete.)*
3. Stabilize dialog, row, field, button, segmented control, and toast contracts.
   *(Complete.)*
4. Extract canonical tokens and generate web/native representations. *(Theme
   colors and shared typography, dimension, and motion foundations complete.)*
5. Create platform packages only when dependencies and APIs are clear.
6. Add the React Native Web catalog, then on-device Storybook and composition.

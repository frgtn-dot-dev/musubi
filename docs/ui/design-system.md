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

Until `packages/design-system` exists, reference values live in
`apps/web/src/design/tokens.css` and their native counterparts in
`apps/client/constants/theme.ts`. Name a new value by role before adding it;
a hardcoded color, gap, radius, or motion duration inside a component needs an
explicit reason.

- A primitive token does not say where it is used (`shu-600`, `space-4`).
- A semantic token communicates purpose (`text-secondary`, `surface-raised`).
- A component token exists only for a stable exception (`dialog-inline-padding`).
- Responsive values use one ladder: 599 / 1023 / 1439 px.
- Web px and native dp may differ, but the role and optical result should match.

## 4. Components and layers

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

Every public component has:

- named variants instead of screen-specific CSS overrides;
- default, hover, focus-visible, pressed/selected, disabled, and pending/error
  states where they apply;
- an accessible name, keyboard path, and correct focus return;
- an API that describes role (`variant="danger"`), not appearance (`red=true`).

## 5. Storybook contract

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
static catalog with `pnpm storybook:web:build`. The baseline catalog visualizes
the implemented color, typography, spacing, shape, motion, and responsive
contracts. It also covers Button, Checkbox, ColorPicker, DatePicker, Dialog,
Empty, Field, Row, SectionLabel, Segmented, Select, Switch, TimePicker, and Toast
without forking their production implementations.

## 6. Workflow

1. Check the existing primitive and the rules in `calendar-ui.md`.
2. If a general contract is missing, design it in Storybook with real content.
3. For a substantial visual change, reproduce the current state in Superdesign
   first, then compare variants; implementation starts after direction approval.
4. Implement one component or pattern and migrate a bounded set of consumers.
5. Verify typecheck, lint, unit tests, Storybook build, and relevant a11y checks.
6. Update this document when a change introduces a new rule.

## 7. Definition of Done

- No second implementation of existing general-purpose UI was introduced.
- A domain component does not own a generic shell.
- Values read from tokens and the component works in light and dark themes.
- The state and responsive matrix is visible in stories.
- The core workflow is keyboard operable; color is not the only signal.
- APIs and stories use realistic Musubi content, not `Lorem ipsum`.
- The change does not violate R1–R12 or the checklist in `calendar-ui.md`.

## 8. Anti-patterns

- copying Radix dialog markup into a feature component;
- naming a general component after one screen;
- adding one prop per CSS property instead of a constrained variant set;
- using different names for the same role on web and mobile;
- a central stories directory detached from component source;
- a universal cross-platform React component full of `isWeb` branches;
- presenting a Superdesign draft as implemented truth;
- adding a token without a role or a magic number without a named constant.

## 9. Adoption order

1. Document the inventory and current system.
2. Run Storybook around existing web primitives without moving them.
3. Stabilize dialog, row, field, button, segmented control, and toast contracts.
4. Extract canonical tokens and generate web/native representations.
5. Create platform packages only when dependencies and APIs are clear.
6. Add the React Native Web catalog, then on-device Storybook and composition.

---
name: musubi-ui
description: >-
  Build, change, or review Musubi web UI while preserving its design language,
  reusing existing components and tokens, and avoiding duplicate CSS or
  dependencies. Use for React UI, CSS, responsive behavior, accessibility,
  Storybook, dialogs, forms, calendar views, and visual polish under apps/web.
---

# Musubi web UI

Maintain Musubi's own system. Do not replace it with an external component
library.

## Read before editing

1. Read relevant sections of `docs/ui/design-system.md`.
2. For calendar behavior, layers, time geometry, gestures, or responsive shell
   work, read relevant sections of `docs/ui/calendar-ui.md`.
3. Inspect current implementation, callers, colocated stories, and matching
   screenshots in `ui-catalog/`.

Docs describe intent; production components and Storybook are implemented truth.

## Existing system

| Need                           | Source                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| Shared renderer-free tokens    | `packages/design-system`                                       |
| Web tokens and global behavior | `apps/web/src/design`                                          |
| Generic web primitives         | `apps/web/src/ui`                                              |
| Feature compositions           | `apps/web/src/calendar/components` and route/component folders |
| Implemented component catalog  | colocated `*.stories.tsx` files                                |
| Screen and layer baselines     | `ui-catalog/light` and `ui-catalog/dark`                       |

Keep renderers platform-specific. Do not move web components into a new package
until extraction removes proven duplication.

## Workflow

### 1. Reuse first

Search `apps/web/src/ui`, existing feature components, and stories before adding
code. Extend an existing named variant when role is general. Do not add
screen-specific appearance props to generic primitives.

Use:

- `Button` / `IconButton` for actions; `buttonClassName` for links styled as
  actions.
- `Dialog` / `ConfirmationDialog` for modal decisions.
- `PopoverContent` for anchored lightweight layers.
- `Menu` for short command lists, never one action or persistent choices.
- `Field`, `Row`, `SettingsSection`, `Segmented`, `Select`, `Switch`,
  `Checkbox`, and existing pickers for their named roles.
- `Toast` for non-blocking feedback with at most one Undo action.

Only shared primitives may import Radix directly.

### 2. Put code at correct layer

- Generic, stable, repeated UI: `apps/web/src/ui`, with colocated stories.
- Domain-specific content and layout: owning feature folder.
- Shared colors, spacing, type, radii, control sizes, or motion:
  `packages/design-system` TypeScript source, then regenerate.
- Calendar geometry and measured interaction values: owning calendar logic, not
  global design tokens.

No speculative abstraction or parallel component package.

### 3. Preserve visual language

- Warm washi surfaces, sumi text, restrained vermilion, muted calendar pigments.
- Inter Tight for working UI; Noto Serif for orientation and meaningful titles.
- Quiet geometry, low-contrast grid, dominant event content.
- No gratuitous gradients, glassmorphism, floating card mosaics, oversized app
  headings, or generic blue SaaS chrome.
- Use spacing, type, radius, control, and motion tokens by semantic
  relationship.
- Raw CSS values are acceptable only for 1 px rules, domain geometry, responsive
  boundaries, measured/dynamic values, or documented optical exceptions.
- Prefer CSS modules. Inline styles should pass dynamic values through CSS
  custom properties, not recreate static styling.

### 4. Respect approval gate

Routine bug fixes and composition from approved patterns may go directly to
production.

For a substantial restyle or new visual pattern:

1. Reproduce current state from `ui-catalog`.
2. Prepare a Storybook variant using realistic Musubi content.
3. Explain only meaningful trade-offs.
4. Get human approval before changing production UI.

A user-provided approved design or explicit instruction to implement one counts
as approval.

### 5. Keep interaction contracts

- Correctness, accessibility, context continuity, and reversibility outrank
  polish.
- Preserve date, view, scroll, focus, draft, and active object unless task
  explicitly changes them.
- Support light/dark and `<=599`, `600–1023`, `1024–1439`, `>=1440` behavior
  where affected.
- Every interaction needs accessible name, keyboard path, focus-visible
  behavior, and correct focus return.
- Color cannot be sole signal.
- Shared layer owns shell geometry; feature content must not compensate with
  negative margins or rebuild insets.

## Dependency policy

Do not add UI, styling, icon, animation, picker, form, or component-library
dependencies without explicit human approval. First use native platform
behavior, existing Musubi primitives, existing Radix packages, and
`lucide-react`.

If approval is requested, state exact missing capability, current alternatives,
bundle/maintenance cost, and how Musubi styling remains authoritative. Do not
install before approval.

## Verification

Run smallest relevant checks:

```bash
pnpm --filter @musubi/web typecheck
pnpm --filter @musubi/web lint
pnpm --filter @musubi/web test
```

When changing a public primitive or story, also run:

```bash
pnpm storybook:web:test
```

Run relevant Playwright scenario for changed user flow. Update `ui-catalog` only
when baseline change is approved.

## Done when

- Existing primitive was reused or missing general contract was added once.
- No parallel palette, spacing scale, shell, or dependency appeared.
- Production behavior matches approved design and current interaction rules.
- Relevant story shows realistic overview, variants, states, and narrow anatomy.
- Keyboard, accessibility, themes, responsive behavior, and checks pass.

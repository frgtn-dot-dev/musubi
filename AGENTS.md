# Musubi agent instructions

## Web UI

For any UI, styling, interaction, or accessibility work under `apps/web`, load
and follow `.agents/skills/musubi-ui/SKILL.md` before editing.

Hard rules:

- Preserve Musubi's existing visual identity. Do not imitate generic SaaS UI or
  another calendar product.
- Reuse `apps/web/src/ui` primitives and existing feature patterns before
  writing markup or CSS.
- Feature code may own domain composition, never a second generic button, field,
  dialog, popover, menu, row, picker, or toast shell.
- Use shared semantic and foundation tokens. Hardcoded values are limited to
  domain geometry, 1 px rules, and documented optical exceptions.
- Keep Radix imports inside shared primitives in `apps/web/src/ui`.
- Do not add a UI or styling dependency without explicit human approval.
  Existing dependencies are not permission to introduce a parallel component
  system.
- For substantial restyles or new visual patterns, propose a Storybook variant
  and get approval before changing production UI. Explicitly approved designs
  and routine composition from existing patterns may proceed directly.
- Preserve keyboard behavior, focus return, accessible names, contrast, reduced
  motion, light/dark themes, and narrow layouts.
- Do not edit generated files in `packages/design-system`; edit their TypeScript
  sources and regenerate.

Current sources of truth:

- Active consolidation plan: `docs/ui/ui-consolidation-plan.md`
- `docs/ui/design-system.md`
- `docs/ui/calendar-ui.md`
- `packages/design-system`
- `apps/web/src/design`
- `apps/web/src/ui`
- `ui-catalog`

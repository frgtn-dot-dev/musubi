# Theme inventory

Generated from the real codebase on 2026-08-01.

This inventory describes the contract. Do not copy values from this document
into components; use the canonical files listed below.

## Canonical sources

- `packages/design-system/src/theme-tokens.ts` — shared semantic colors
- `packages/design-system/src/foundation-tokens.ts` — renderer-free numeric foundations
- `packages/design-system/src/colors.css` — generated web color representation
- `packages/design-system/src/foundations.css` — generated web foundation representation
- `apps/web/src/design/tokens.css` — web fonts and feature/platform geometry
- `apps/client/constants/theme.ts` — React Native theme adapter and native styles

Run `pnpm --filter @musubi/design-system generate` after changing a canonical
token. The package self-check rejects committed CSS that no longer matches its
TypeScript source.

## Semantic color mapping

| Role | Web | Native |
|---|---|---|
| canvas | `--surface-canvas` | `colors.bg` |
| panel | `--surface-panel` | `colors.bg1` |
| raised | `--surface-raised` | `colors.bg2` |
| overlay | `--surface-overlay` | platform-owned modal surface |
| primary text | `--text-primary` | `colors.fg` |
| secondary text | `--text-secondary` | `colors.fg2` |
| muted text | `--text-muted` | `colors.fg3` |
| faint text | `--text-faint` | `colors.fg4` |
| subtle border | `--border-subtle` | `colors.line` |
| medium border | `--border-medium` | `colors.line2` |
| strong border | `--border-strong` | `colors.line3` |
| control fill | `--control-fill` | `colors.fill` |
| on control | `--control-on-fill` | `colors.onFill` |
| accent | `--accent-primary` | `colors.accent` |

## Shared foundations

| Foundation | Contract |
|---|---|
| spacing | eight-step 4 px ladder, exposed as `spacing` and `--space-1..8` |
| type sizes | numeric ramp from 10 through 32, exposed as `typeSizes` and `--text-*` |
| radii | `sm`, `md`, `lg`, `pill`, `sheet`, `card`, `control`, and `chip` |
| regular controls | 44 px default, 38 px compact |
| touch controls | 48 px default, 44 px compact |
| repeated row | 62 px minimum height |
| web motion | 140/220/300 ms for `fast`/`standard`/`slow` |
| native motion | 160/260/320 ms for `fast`/`standard`/`slow` |

Web serializes type sizes as rem so browser font-size preferences remain
effective. React Native consumes the same numeric sizes as density-independent
values. Motion roles are shared, while their durations are platform-tuned for
touch legibility.

## Intentionally platform-owned

- loaded font resources and fallback stacks;
- responsive shell, sidebar, tab, and safe-area geometry;
- calendar grid and event geometry;
- gesture-following, press-in, and spring timings;
- documented optical exceptions owned by one component or feature.

The complete composition, responsive, accessibility, and component rules live
in `docs/ui/design-system.md`. Calendar behavior remains governed by
`docs/ui/calendar-ui.md`.

# Musubi design system context

## Product

Musubi is a calm, high-density calendar and collaboration product for web and
native mobile. Calendar behavior is governed by `docs/ui/calendar-ui.md`; never
trade temporal correctness, accessibility, context continuity, or reversibility
for visual novelty.

## Identity

- Original Musubi language, not a Google Calendar imitation.
- Sumi ink on washi paper; warm off-white light surfaces and near-black dark
  surfaces rather than clinical white/blue SaaS chrome.
- Inter Tight for working UI, Noto Serif for meaningful titles and orientation,
  restrained kanji accents only where already part of the product.
- Vermilion/shu is rare and purposeful. Dune, moss, ochre and indigo are muted
  calendar pigments, not generic status colors.
- Quiet geometry, low-contrast grid, strong event content, generous but compact
  rhythm. No gratuitous gradients, glassmorphism, floating card mosaics or huge
  marketing typography inside the application.

## Current sources of truth

- Web tokens: `apps/web/src/design/tokens.css`
- Web global behavior: `apps/web/src/design/global.css`
- Native theme: `apps/client/constants/theme.ts`
- Web primitives: `apps/web/src/ui`
- Native primitives: `apps/client/components/ui`
- Design rules: `docs/ui/design-system.md`
- Calendar behavior: `docs/ui/calendar-ui.md`

## Component policy

Share semantic tokens, component names, roles and state contracts across
platforms. Keep DOM/Radix and React Native implementations platform-specific.
Feature code owns domain content, never a new generic button, field, menu,
dialog, popover, sheet or toast shell.

Layers retain distinct interaction contracts: dialog for consequential editing,
sheet for narrow/native modal detail, popover for anchored lightweight context,
menu for immediate commands, toast for non-blocking feedback with at most one
Undo action.

Every public component needs realistic Overview, Variants and States stories;
add Narrow when anatomy changes. Support light/dark, keyboard operation,
focus-visible, long content, disabled/pending/error states as applicable.

## Responsive contract

- <=599: overlay navigation, FAB, popover becomes sheet where specified.
- 600-1023: overlay/compact navigation.
- 1024-1439: permanent sidebar, compact desktop chrome.
- >=1440: full desktop shell.

Adapt hierarchy and interaction; do not merely scale desktop down.

## Design workflow

For redesign work, first reproduce the current real UI on the Superdesign
canvas. Branch variants from that baseline and obtain approval before changing
production UI. Superdesign is exploration; Storybook is implemented truth.

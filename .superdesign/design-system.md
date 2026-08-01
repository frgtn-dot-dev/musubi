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

- Shared semantic theme tokens: `packages/design-system`
- Web geometry and renderer tokens: `apps/web/src/design/tokens.css`
- Web global behavior: `apps/web/src/design/global.css`
- Native theme adapter: `apps/client/constants/theme.ts`
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

## Geometry and rhythm

Use the 4 px spacing ladder by relationship: 4 px adjacent, 8 px related,
12 px control group, 16 px compact component inset, 20 px field group, 24 px
layer inset, and 32 px section break. Do not choose spacing independently for a
screen or use separators to compensate for weak whitespace hierarchy.

Layer interiors have two densities:

- Regular, >=600 px: modal viewport gutter 24 px, layer inline inset 24 px,
  dialog body block inset 20 px, footer block inset 16 px, default controls
  44 px and compact controls 38 px.
- Touch, <=599 px: edge-to-edge bottom sheet, layer inline inset 20 px, body
  block inset 20 px, footer block inset 16 px plus the safe area, default
  controls 48 px and compact targets at least 44 px.

Calendar breakpoints at 1023 and 1439 px may change shell architecture but must
not silently change a layer's internal rhythm. A layer shell owns its viewport
gutter, width, radius, elevation, and region insets. Header, padded body, and
footer share one inline axis. Edge-to-edge lists require an explicit flush-body
variant, while readable content inside them still aligns to the layer axis.
Nested fields do not repeat the shell inset.

Use whitespace before borders. Header/footer separators appear only when a
scrolling body or repeated rows need a persistent boundary. Regular footer
actions align right, secondary before primary, with an 8 px gap; touch actions
wrap or stack only when labels and minimum targets do not fit. Dialog target
widths are 400 px compact, 520 px default, and 720 px wide, always constrained
by the viewport gutter.

Forms use 8 px from label to control, 4 px from control to help/error, 20 px
between complete fields, and 32 px between distinct field sections. Dividers
belong to repeated rows and real region boundaries, never to a field by default.
When edges disagree, fix the component that owns the shared axis instead of
patching the feature consumer.

Settings use an explicit inset-group pattern because named, bounded groups are
faster to scan than one long flush list. `SettingsSection` aligns its title and
group edge to the layer axis (24 px regular, 20 px touch), places the title 8 px
above the group, and leaves 32 px between sections. The group uses the panel
surface, subtle border, and 14 px radius without a gradient or shadow. Rows use
their own 16 px internal inset, grow from a 62 px minimum, and draw focus rings
inward so the rounded clipping edge never hides keyboard focus.

Buttons use four semantic roles: one primary action per region, secondary for a
supporting or cancel action, ghost for quiet toolbar and inline actions, and
destructive only when consequences require explicit emphasis. The default
control size matches form controls; compact belongs to dense chrome. At touch
widths both sizes grow to the shared minimum targets. Labels stay concise and
on one line, action groups stack when space runs out, and loading never changes
the button geometry or accessible name. Icon-only buttons use the same roles
and sizes, require an accessible label, and expose pressed or expanded state
when they behave as toggles or layer triggers.

Only one toast is visible at a time; a new notice replaces it. Neutral messages
are polite status announcements, while errors are assertive alerts with a
visible error icon and border tone. Toast messages are concise and do not take
focus. The only action is Undo, represented by one label/callback object and
kept outside the message's live region. Plain acknowledgements remain for 3.5
seconds and Undo for 9 seconds. Message-only and Undo anatomies share one
centered region and maximum width: plain padding is symmetrical, while the
compact Undo inset must not shift the toast midpoint. Features may reposition
the region above persistent chrome but do not alter its internal geometry.

Segmented controls expose two to four short, mutually exclusive options. The
compact size is the default; the control size matches regular form controls.
Options share available width and remain on one line. Touch layouts may reduce
their internal inset, but if the real labels still cannot fit at 320 px, use a
Select rather than truncating, wrapping, or horizontally scrolling the choices.
Arrow keys wrap and skip disabled options; Home and End select the first and
last enabled choices.

## Design workflow

For redesign work, first reproduce the current real UI on the Superdesign
canvas. Branch variants from that baseline and obtain approval before changing
production UI. Superdesign is exploration; Storybook is implemented truth.

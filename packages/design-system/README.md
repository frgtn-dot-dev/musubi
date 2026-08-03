# @musubi/design-system

The values every Musubi client shares: the two colour schemes, the spacing and
type scales, radii, control heights and motion durations. Renderer-free — web
turns them into CSS custom properties, native consumes the same numbers as
density-independent points.

Nothing here knows about a component. A token names a purpose (`textMuted`,
`surfaceSunken`), never a place it is used.

## Generated files

`pnpm generate` writes three files from the TypeScript sources. They are
committed, and the test suite fails if they are stale:

| File | For |
| --- | --- |
| `src/colors.css` | The two schemes as CSS custom properties |
| `src/foundations.css` | Spacing, type, radii, control heights, motion |
| `design-tokens.json` | The same values in the W3C design-tokens shape |

Never edit those three by hand. Edit `theme-tokens.ts` or
`foundation-tokens.ts` and regenerate.

## Editing tokens in a design tool

`design-tokens.json` is the one layer of the design that can be edited outside
the repository without either copy drifting. Import it, change colours or
spacing, export it back, and the values map onto the code one-for-one — leaf keys
are the token names exactly as the code spells them (`light.surfaceCanvas`, not
`light.surface.canvas`), so nothing needs a translation table on the way home.

Colours are 8-digit hex when translucent (`#1c1b1814`) and 6-digit when not.
Dimensions and durations carry their unit (`16px`, `220ms`).

Check an export before applying it:

```
pnpm check-tokens ~/Downloads/musubi-tokens.json
```

It prints what changed, in the form the source is written in (`#1c1b1814` comes
back as `rgba(28, 27, 24, 0.08)`, so it can be pasted straight in), and then runs
the palette's own contrast rules over the result. Exit 1 means a text colour
stopped clearing 4.5:1 somewhere — those lines must not be applied. Tokens the
file omits are left alone; keys that are not Musubi tokens are listed and ignored.

It never writes `theme-tokens.ts`. That file carries the reasoning for each value
— why `textMuted` is exactly 0.64, which surface is its worst case — and a
generator would replace all of it with a hex code.

Two things deliberately do not travel:

- **`shadowOverlay`** is a whole CSS shadow — offsets, blur and a colour — not a
  colour, so it stays here.
- **Components and screens.** A design tool can redraw a dialog, but nothing
  keeps the drawing and the code in step afterwards. `ui-catalog/` holds a
  screenshot of every screen and layer in both themes for looking at; the code is
  where they are built.

## Contrast is checked, not asserted

`contrast.ts` computes WCAG relative luminance, and `theme-tokens.test.ts` uses
it to prove that every token carrying words clears 4.5:1 on every surface it can
land on. A token edited in a design tool has to pass the same check before it
comes back in — which is the reason the check lives beside the values rather than
in an audit somewhere.

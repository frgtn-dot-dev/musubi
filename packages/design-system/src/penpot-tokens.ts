import {
  componentDimensions,
  controlHeights,
  motionDurations,
  radii,
  spacing,
  typeSizes,
} from "./foundation-tokens";
import { parseColor } from "./contrast";
import { themeTokens, type ThemeScheme } from "./theme-tokens";

/**
 * Musubi's tokens in the W3C design-tokens shape, for a design tool to import.
 *
 * Only the token layer travels. Components and screens do not: a design tool can
 * redraw them but nothing keeps the drawing and the code in step, whereas these
 * values are the same handful of numbers and colours on both sides — so they can
 * be edited over there and read back here without either copy drifting.
 *
 * Leaf keys are the token names exactly as the code spells them
 * (`light.surfaceCanvas`, not `light.surface.canvas`), so reading the file back
 * needs no mapping table and cannot silently rename anything.
 */

type Token = { $type: "color" | "dimension" | "duration"; $value: string };
type TokenGroup = { [key: string]: Token | TokenGroup };

/**
 * `rgba(28, 27, 24, 0.08)` as `#1c1b1814`.
 *
 * Design tools read 8-digit hex; several do not read CSS `rgba()`. Opaque colours
 * come back as plain 6-digit hex so a palette stays readable by eye.
 */
function toHex(value: string): string {
  const { alpha, rgb } = parseColor(value);
  const [red, green, blue] = rgb;
  const pair = (channel: number) =>
    Math.round(channel).toString(16).padStart(2, "0");
  const base = `#${pair(red)}${pair(green)}${pair(blue)}`;

  return alpha >= 1 ? base : `${base}${pair(alpha * 255)}`;
}

/**
 * Every theme token that is a colour.
 *
 * `shadowOverlay` is a whole CSS shadow — offsets, blur and a colour — so it is
 * not one, and a design tool's shadow type is a structured value rather than a
 * string. Left in the code, where the one place it is written is the one place it
 * is read.
 */
function colors(scheme: ThemeScheme): TokenGroup {
  return Object.fromEntries(
    Object.entries(themeTokens[scheme])
      .filter(([name]) => !name.startsWith("shadow"))
      .map(([name, value]) => [
        name,
        { $type: "color", $value: toHex(value) } satisfies Token,
      ]),
  );
}

function dimensions(values: Record<string, number>): TokenGroup {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { $type: "dimension", $value: `${value}px` } satisfies Token,
    ]),
  );
}

function durations(values: Record<string, number>): TokenGroup {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { $type: "duration", $value: `${value}ms` } satisfies Token,
    ]),
  );
}

export function penpotTokens(): TokenGroup {
  return {
    // Purpose-named and per scheme, which is how the code stores them: a design
    // tool's own theme switch then maps onto the two sets rather than onto two
    // unrelated palettes.
    dark: colors("dark"),
    light: colors("light"),
    // Scheme-independent, so they sit outside both.
    motion: durations(motionDurations.web),
    motionNative: durations(motionDurations.native),
    radius: dimensions(radii),
    size: dimensions({
      ...componentDimensions,
      controlPointer: controlHeights.pointer.control,
      controlPointerCompact: controlHeights.pointer.compact,
      controlTouch: controlHeights.touch.control,
      controlTouchCompact: controlHeights.touch.compact,
    }),
    spacing: dimensions(spacing),
    text: dimensions(typeSizes),
  };
}

type Leaf = { $value?: unknown };

/**
 * Every leaf with a `$value`, keyed by its dotted path.
 *
 * Walked rather than indexed, because a design tool is free to nest differently,
 * reorder, or add `$description` on the way out. Only the leaves are the
 * agreement, and only their paths have to match.
 */
export function flattenTokens(
  node: unknown,
  path: string[] = [],
): Map<string, string> {
  const found = new Map<string, string>();
  if (typeof node !== "object" || node === null) return found;

  const value = (node as Leaf).$value;
  if (value !== undefined) {
    found.set(path.join("."), String(value));
    return found;
  }

  for (const [key, child] of Object.entries(node)) {
    // `$type`, `$description` and anything else the spec puts beside a value.
    if (key.startsWith("$")) continue;
    for (const [leafPath, leafValue] of flattenTokens(child, [...path, key])) {
      found.set(leafPath, leafValue);
    }
  }

  return found;
}

/**
 * `#1c1b1814` back to the `rgba()` form `theme-tokens.ts` is written in.
 *
 * The source keeps translucent colours as `rgba()` so the alpha is a number
 * somebody can reason about — 0.08 is a hairline, 0x14 is a lookup.
 */
export function toSourceColor(hex: string): string {
  const digits = hex.replace(/^#/, "");
  if (digits.length !== 8) return hex.toLowerCase();

  const channel = (index: number) =>
    Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  const alpha = Number((channel(3) / 255).toFixed(2));

  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
}

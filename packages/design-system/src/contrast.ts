/**
 * WCAG relative luminance and contrast, so the palette can prove its own claims.
 *
 * A token that carries words has to be legible on every surface it can land on.
 * That is checkable arithmetic, not taste, and it belongs next to the values —
 * a review will not catch 3.22:1, and an accessibility audit catches it only
 * once a screen already ships.
 */

type Rgb = readonly [number, number, number];

/** Accepts `#rgb`, `#rrggbb` and `rgba(r, g, b, a)`; alpha is returned apart. */
export function parseColor(value: string): { alpha: number; rgb: Rgb } {
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());

  if (rgba) {
    const parts = rgba[1]!.split(",").map((part) => Number(part.trim()));
    const [red, green, blue, alpha = 1] = parts;
    return {
      alpha,
      rgb: [red ?? 0, green ?? 0, blue ?? 0],
    };
  }

  const hex = value.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : hex;

  if (!/^[\da-f]{6}$/i.test(expanded)) {
    throw new Error(`Not a colour this palette can use: ${value}`);
  }

  return {
    alpha: 1,
    rgb: [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ],
  };
}

/** What a translucent colour actually becomes once it sits on a surface. */
export function composite(foreground: string, background: string): Rgb {
  const front = parseColor(foreground);
  const back = parseColor(background);

  return front.rgb.map((channel, index) =>
    Math.round(front.alpha * channel + (1 - front.alpha) * back.rgb[index]!),
  ) as unknown as Rgb;
}

export function relativeLuminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Contrast ratio of a (possibly translucent) colour against a surface. */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(composite(foreground, background)),
    relativeLuminance(parseColor(background).rgb),
  ].sort((first, second) => second - first);

  return (lighter! + 0.05) / (darker! + 0.05);
}

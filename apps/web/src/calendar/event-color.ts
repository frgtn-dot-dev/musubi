import { DEFAULT_CALENDAR_COLOR } from "@musubi/types";

const DARK_EVENT_TEXT = "#000";
const LIGHT_EVENT_TEXT = "#fff";

type Rgb = readonly [number, number, number];

function parseHexColor(value: string): Rgb | null {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalized;

  if (!/^[\da-f]{6}$/i.test(expanded)) {
    return null;
  }

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: Rgb) {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map(
    (channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    },
  );

  return (
    0.2126 * linearRed! + 0.7152 * linearGreen! + 0.0722 * linearBlue!
  );
}

export function getReadableEventTextColor(backgroundColor: string) {
  const background =
    parseHexColor(backgroundColor) ??
    parseHexColor(DEFAULT_CALENDAR_COLOR)!;
  const luminance = relativeLuminance(background);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithBlack >= contrastWithWhite
    ? DARK_EVENT_TEXT
    : LIGHT_EVENT_TEXT;
}

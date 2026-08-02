/**
 * The looks a published event page can wear.
 *
 * A closed set on purpose. `PRD §17.3` splits an event page into what an
 * organizer may change (background, palette, font, layout) and what they may
 * not (accessibility, the RSVP flow, when-and-where, privacy, export, safe
 * rendering) — and "no arbitrary CSS or JavaScript in the first version".
 *
 * Enumerating the palettes is how that line is held rather than promised: a
 * colour that never enters the system cannot break contrast, and the self-check
 * next door proves every combination that ships is legible. Free-form colours
 * would move that guarantee from arithmetic to hope.
 */

export type EventPagePalette = {
  /** Hairlines and dividers. Explicit, not mixed at runtime: a computed colour
   *  is one more thing that can resolve to nothing on a browser that disagrees
   *  about `color-mix`, and a page whose buttons vanish is not a style choice. */
  border: string;
  /** Inputs and secondary blocks sitting on `surface`. */
  raised: string;
  /** Buttons and the accents that carry meaning. */
  accent: string;
  /** Text ON the accent. Paired here so the two are chosen together. */
  accentText: string;
  /** The page behind the card. */
  background: string;
  id: string;
  label: string;
  /** Secondary copy: the organizer line, the timezone, the footer. */
  muted: string;
  /** The card the event sits on. */
  surface: string;
  /** Body and heading text on `surface`. */
  text: string;
};

export const eventPagePalettes: EventPagePalette[] = [
  {
    accent: "#a13f27",
    accentText: "#ffffff",
    background: "#f4f1e8",
    border: "#d8d1bf",
    id: "sand",
    raised: "#f7f4ec",
    label: "Sand",
    muted: "#5f5a50",
    surface: "#ece7da",
    text: "#1c1b18",
  },
  {
    accent: "#c96f4a",
    accentText: "#14130f",
    background: "#14130f",
    border: "#332f27",
    id: "ink",
    raised: "#26231d",
    label: "Ink",
    muted: "#a49d90",
    surface: "#1e1c17",
    text: "#f0ebe0",
  },
  {
    accent: "#356047",
    accentText: "#ffffff",
    background: "#eef1ea",
    border: "#ccd3c6",
    id: "moss",
    raised: "#f1f4ee",
    label: "Moss",
    muted: "#54604f",
    surface: "#e3e8de",
    text: "#161a14",
  },
  {
    accent: "#2a5379",
    accentText: "#ffffff",
    background: "#eef1f5",
    border: "#c9d3de",
    id: "harbour",
    raised: "#f0f4f8",
    label: "Harbour",
    muted: "#4e5a68",
    surface: "#e2e8ef",
    text: "#141a20",
  },
  {
    accent: "#7c3557",
    accentText: "#ffffff",
    background: "#f6eef2",
    border: "#dccbd3",
    id: "plum",
    raised: "#f8f1f4",
    label: "Plum",
    muted: "#63505a",
    surface: "#eee2e8",
    text: "#1d1418",
  },
];

/** Layouts, not templates: the same content, arranged for a different purpose. */
export const eventPageLayouts = [
  { id: "classic", label: "Classic" },
  // A poster leads with the title and the date at display size — for something
  // being put on a wall or a social post rather than read carefully.
  { id: "poster", label: "Poster" },
] as const;

export const eventPageFonts = [
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
] as const;

export const eventPageCovers = [
  { id: "none", label: "None" },
  { id: "wash", label: "Colour wash" },
  { id: "grid", label: "Grid" },
] as const;

export type EventPageLayoutId = (typeof eventPageLayouts)[number]["id"];
export type EventPageFontId = (typeof eventPageFonts)[number]["id"];
export type EventPageCoverId = (typeof eventPageCovers)[number]["id"];

export function eventPagePalette(id: string | undefined): EventPagePalette {
  return (
    eventPagePalettes.find((palette) => palette.id === id) ??
    eventPagePalettes[0]!
  );
}

/** The palette as CSS variables the page can hand to its own stylesheet. */
export function eventPagePaletteVariables(
  palette: EventPagePalette,
): Record<string, string> {
  return {
    "--page-accent": palette.accent,
    "--page-accent-text": palette.accentText,
    "--page-background": palette.background,
    "--page-border": palette.border,
    "--page-muted": palette.muted,
    "--page-raised": palette.raised,
    "--page-surface": palette.surface,
    "--page-text": palette.text,
  };
}

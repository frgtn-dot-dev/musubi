import assert from "node:assert/strict";
import { contrastRatio } from "./contrast";
import { eventPagePalette, eventPagePalettes } from "./event-page-themes";

// Accessibility is on the fixed side of `PRD §17.3` — an organizer may choose a
// look, never an unreadable one. Because the palettes are a closed set, that is
// arithmetic rather than a promise: every pairing that can reach a screen is
// checked here, and a new palette cannot be added without passing.
const BODY_MINIMUM = 4.5; // WCAG AA, normal text
const LARGE_MINIMUM = 3; // AA for large text, which is all `muted` is used for

for (const palette of eventPagePalettes) {
  const say = (what: string, ratio: number, minimum: number) =>
    assert.ok(
      ratio >= minimum,
      `${palette.id}: ${what} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
    );

  // Body copy on the card, and on the page behind it — both happen, because a
  // poster layout puts text straight onto the background.
  say("text on surface", contrastRatio(palette.text, palette.surface), BODY_MINIMUM);
  say(
    "text on background",
    contrastRatio(palette.text, palette.background),
    BODY_MINIMUM,
  );

  // Secondary copy still has to be read, not merely seen.
  say("muted on surface", contrastRatio(palette.muted, palette.surface), LARGE_MINIMUM);
  say(
    "muted on background",
    contrastRatio(palette.muted, palette.background),
    LARGE_MINIMUM,
  );

  // The accent carries the primary button, so its label is body text.
  say(
    "accent text on accent",
    contrastRatio(palette.accentText, palette.accent),
    BODY_MINIMUM,
  );

  // The accent is not only a border: it colours links on the page, at body size.
  // Axe caught 4.34:1 here once, which is what raised this from 3:1 — the check
  // is only worth having if it holds the same bar the page is judged by.
  say("accent on surface", contrastRatio(palette.accent, palette.surface), BODY_MINIMUM);
  say(
    "accent on background",
    contrastRatio(palette.accent, palette.background),
    BODY_MINIMUM,
  );

  // Inputs and secondary blocks sit on `raised`, and they carry body text.
  say("text on raised", contrastRatio(palette.text, palette.raised), BODY_MINIMUM);
  say("muted on raised", contrastRatio(palette.muted, palette.raised), LARGE_MINIMUM);
  // A hairline is not text, but an invisible one is not a hairline.
  say("border on surface", contrastRatio(palette.border, palette.surface), 1.2);
}

// Ids are what the database stores, so two palettes may not share one.
{
  const ids = eventPagePalettes.map((palette) => palette.id);
  assert.equal(new Set(ids).size, ids.length, "palette ids must be unique");
}

// An unknown id — an older page, a hand-edited row — renders as the default
// rather than as nothing.
assert.equal(eventPagePalette("no-such-palette").id, eventPagePalettes[0]!.id);
assert.equal(eventPagePalette(undefined).id, eventPagePalettes[0]!.id);

console.log("event page palette contrast self-check: OK");

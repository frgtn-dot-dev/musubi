import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseColor } from "./contrast";
import {
  flattenTokens,
  penpotTokens,
  toSourceColor,
} from "./penpot-tokens";
import { themeTokens } from "./theme-tokens";

const generatedPath = fileURLToPath(
  new URL("../design-tokens.json", import.meta.url),
);

// ── Colours survive the trip out ─────────────────────────────────────────────
// The point of the file is that a design tool can edit these and the code can
// read them back, so a value that arrives wrong is worse than no file at all —
// it looks like a decision somebody made.
{
  const tokens = penpotTokens() as Record<
    string,
    Record<string, { $type: string; $value: string }>
  >;

  // Opaque colours stay readable by eye; a translucent one gains its alpha pair.
  assert.equal(tokens.light!.surfaceCanvas!.$value, "#f4f1e8");
  assert.equal(tokens.dark!.accentPrimary!.$value, "#c8553d");
  assert.equal(tokens.light!.borderSubtle!.$value, "#1c1b1814");
  assert.equal(tokens.light!.surfaceOverlay!.$value, "#f4f1e8f0");

  // 0.08 × 255 = 20.4, which has to round rather than truncate: 0x14 is 20.
  assert.match(tokens.light!.borderSubtle!.$value, /^#[\da-f]{8}$/);

  // Every colour token is exported except the shadow, which is a whole CSS
  // shadow rather than a colour.
  const expected = Object.keys(themeTokens.light).filter(
    (name) => !name.startsWith("shadow"),
  );
  assert.deepEqual(Object.keys(tokens.light!).sort(), [...expected].sort());
  assert.deepEqual(Object.keys(tokens.dark!).sort(), [...expected].sort());
  assert.ok(
    !JSON.stringify(tokens).includes("px rgba"),
    "a CSS shadow must not be exported as if it were a colour",
  );

  // Leaf names are the code's own names, so reading the file back needs no
  // mapping table. A group in between would be a place for one to go wrong.
  assert.ok("surfaceCanvas" in tokens.light!);
  assert.ok(!("surface" in tokens.light!));

  // Dimensions and durations carry their unit, which is what a design tool reads.
  assert.equal(tokens.spacing!["4"]!.$value, "16px");
  assert.equal(tokens.spacing!["4"]!.$type, "dimension");
  assert.equal(tokens.text!["14"]!.$value, "14px");
  assert.equal(tokens.motion!.standard!.$value, "220ms");
  assert.equal(tokens.motion!.standard!.$type, "duration");
  assert.equal(tokens.radius!.pill!.$value, "999px");
}

// ── And back in again ────────────────────────────────────────────────────────
// A design tool may nest differently, reorder, or hang a `$description` beside a
// value on the way out. Only the leaf paths are the agreement, so reading has to
// find them wherever they sit.
{
  const nested = {
    light: {
      $description: "edited in a design tool",
      surfaceCanvas: { $type: "color", $value: "#f4f1e8" },
    },
    spacing: { 4: { $type: "dimension", $value: "18px" } },
  };
  const flat = flattenTokens(nested);
  assert.equal(flat.get("light.surfaceCanvas"), "#f4f1e8");
  assert.equal(flat.get("spacing.4"), "18px");
  assert.equal(flat.size, 2, "$description is not a token");

  // The whole export flattens to one leaf per token and nothing else.
  const round = flattenTokens(penpotTokens());
  assert.equal(round.get("light.borderSubtle"), "#1c1b1814");
  assert.equal(round.get("motion.standard"), "220ms");

  // Translucent colours come home as the `rgba()` the source is written in, so a
  // value can be pasted straight in. Opaque ones stay hex, as the source has them.
  assert.equal(toSourceColor("#1c1b1814"), "rgba(28, 27, 24, 0.08)");
  assert.equal(toSourceColor("#f4f1e8f0"), "rgba(244, 241, 232, 0.94)");
  assert.equal(toSourceColor("#B3492F"), "#b3492f");

  // Every colour survives the trip out and back — as a colour, which is the claim
  // the loop actually makes. Not as a string: the source writes white as `#fff`
  // and it comes home as `#ffffff`, which is the same white.
  for (const [name, value] of Object.entries(themeTokens.light)) {
    if (name.startsWith("shadow")) continue;
    const returned = parseColor(toSourceColor(round.get(`light.${name}`)!));
    const original = parseColor(value);
    assert.deepEqual(
      returned.rgb,
      original.rgb,
      `light.${name} changed colour on the round trip`,
    );
    // 8-bit alpha, so 0.74 comes home as 0.74 and not 0.7411764705882353.
    assert.ok(
      Math.abs(returned.alpha - original.alpha) < 0.005,
      `light.${name} alpha drifted: ${original.alpha} → ${returned.alpha}`,
    );
  }
}

// ── The committed file is the current one ────────────────────────────────────
// Generated and committed, so a design tool can import it straight from the
// repository. That only holds if nobody edits a token without regenerating.
{
  const committed = readFileSync(generatedPath, "utf8");
  assert.equal(
    committed,
    `${JSON.stringify(penpotTokens(), null, 2)}\n`,
    "design-tokens.json is stale — run `pnpm generate` in packages/design-system",
  );
}

console.log("penpot token export self-check: OK");

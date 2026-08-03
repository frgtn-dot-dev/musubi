import { readFileSync } from "node:fs";
import { paletteFailures } from "../src/palette-rules";
import {
  flattenTokens,
  penpotTokens,
  toSourceColor,
} from "../src/penpot-tokens";
import { themeTokens, type ThemeScheme } from "../src/theme-tokens";

/**
 * Read a token file exported from a design tool and say whether it may come in.
 *
 * Editing colours in a design tool is only worth it if the palette's own rules
 * still hold afterwards, and 3.9:1 is invisible to the eye that chose it. So this
 * runs the same checks the suite runs on the repository's palette, and prints
 * what changed beside what broke.
 *
 * It never writes the source. `theme-tokens.ts` carries the reasoning for each
 * value — why `textMuted` is exactly 0.64, which surface is the worst case — and
 * a generator would replace all of it with a hex code. Apply the accepted lines
 * by hand; there are never many.
 *
 *   pnpm exec tsx scripts/check-tokens.ts ~/Downloads/musubi-tokens.json
 */

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/check-tokens.ts <exported-tokens.json>");
  process.exit(2);
}

const incoming = flattenTokens(JSON.parse(readFileSync(path, "utf8")));
const current = flattenTokens(penpotTokens());

// ── What the file forgot, and what it invented ───────────────────────────────
const missing = [...current.keys()].filter((key) => !incoming.has(key));
const unknown = [...incoming.keys()].filter((key) => !current.has(key));

if (missing.length > 0) {
  console.log(`Missing ${missing.length} token(s) — left as they are:`);
  for (const key of missing) console.log(`  ${key}`);
}
if (unknown.length > 0) {
  console.log(`\nNot Musubi tokens, ignored:`);
  for (const key of unknown) console.log(`  ${key} = ${incoming.get(key)}`);
}

// ── What actually changed ───────────────────────────────────────────────────
const changed = [...incoming]
  .filter(([key, value]) => current.has(key) && current.get(key) !== value)
  .map(([key, value]) => ({ from: current.get(key)!, key, to: value }));

if (changed.length === 0) {
  console.log("\nNothing changed.");
  process.exit(0);
}

console.log(`\n${changed.length} change(s):`);
for (const { from, key, to } of changed) {
  const source = key.startsWith("light.") || key.startsWith("dark.")
    ? ` → source: ${toSourceColor(to)}`
    : "";
  console.log(`  ${key}: ${from} → ${to}${source}`);
}

// ── Alpha that went missing on the way there ────────────────────────────────
// Penpot resolves every colour token to 6-digit hex, so a translucent one comes
// home solid. Contrast would not catch it — near-black on cream passes easily —
// and the palette would be quietly flattened, which is why this runs first.
const flattened = changed.filter(({ from, to }) => {
  const wasTranslucent = from.replace(/^#/, "").length === 8;
  const isTranslucent = to.replace(/^#/, "").length === 8;
  return wasTranslucent && !isTranslucent;
});

if (flattened.length > 0) {
  console.log(
    `\n${flattened.length} colour(s) lost their alpha — a design tool that stores`,
  );
  console.log("only 6-digit hex did this, and it is not a decision anybody made:");
  for (const { from, key, to } of flattened) {
    console.log(`  ${key}: ${from} → ${to}`);
  }
  console.log("Keep the values in the source. Do not apply these.");
  process.exit(1);
}

// ── Whether the palette still holds ─────────────────────────────────────────
// Applied to a copy of the real palette so a file that only carries three colours
// is still judged against the surfaces those three will land on.
const failures: string[] = [];
for (const scheme of ["light", "dark"] as ThemeScheme[]) {
  const candidate = { ...themeTokens[scheme] };
  for (const [key, value] of incoming) {
    const [prefix, name] = key.split(".");
    if (prefix !== scheme || !(name! in candidate)) continue;
    (candidate as Record<string, string>)[name!] = toSourceColor(value);
  }
  failures.push(...paletteFailures(scheme, candidate));
}

if (failures.length === 0) {
  console.log("\nContrast: every text token still clears 4.5:1. Safe to apply.");
  process.exit(0);
}

console.log(`\nContrast: ${failures.length} failure(s) — do not apply these:`);
for (const line of failures) console.log(`  ${line}`);
process.exit(1);

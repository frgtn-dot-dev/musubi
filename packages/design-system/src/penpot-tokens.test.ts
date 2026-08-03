import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { penpotTokens } from "./penpot-tokens";
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

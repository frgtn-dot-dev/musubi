import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "./contrast";
import { renderFoundationTokensCss, renderThemeTokensCss } from "./css";
import {
  controlHeights,
  motionDurations,
  spacing,
  typeSizes,
} from "./foundation-tokens";
import { themeTokens } from "./theme-tokens";

const generatedCssPath = fileURLToPath(
  new URL("./colors.css", import.meta.url),
);
const generatedFoundationsCssPath = fileURLToPath(
  new URL("./foundations.css", import.meta.url),
);

assert.equal(
  readFileSync(generatedCssPath, "utf8"),
  renderThemeTokensCss(),
  "The committed web representation must match the canonical theme tokens",
);

assert.equal(
  readFileSync(generatedFoundationsCssPath, "utf8"),
  renderFoundationTokensCss(),
  "The committed web representation must match the canonical foundation tokens",
);

assert.deepEqual(
  Object.keys(themeTokens.light),
  Object.keys(themeTokens.dark),
  "Light and dark themes must expose the same semantic roles",
);

assert.equal(typeSizes[13], 13, "Type sizes stay renderer-independent");
assert.equal(spacing[4], 16, "Spacing steps stay renderer-independent");
assert.equal(
  controlHeights.touch.control,
  48,
  "Touch controls keep their minimum target",
);
assert.ok(
  motionDurations.native.standard >= motionDurations.web.standard,
  "Native standard motion must remain at least as legible as web motion",
);

// Every token that carries words must be legible on every surface it can land
// on. Small text has no large-text exemption, so the bar is 4.5:1 flat.
const surfaceRoles = [
  "surfaceCanvas",
  "surfacePanel",
  "surfaceRaised",
  "surfaceSunken",
] as const;
const textRoles = ["textPrimary", "textSecondary", "textMuted"] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const text of textRoles) {
    for (const surface of surfaceRoles) {
      const ratio = contrastRatio(
        themeTokens[scheme][text],
        themeTokens[scheme][surface],
      );
      assert.ok(
        ratio >= 4.5,
        `${scheme}.${text} on ${surface} is ${ratio.toFixed(2)}:1 — text needs 4.5:1`,
      );
    }
  }

  // Reserved for icons, dividers and disabled controls. Asserting it stays
  // *below* the text bar is what keeps it from quietly becoming a text colour:
  // if someone raises it to pass, this fails and they have to say why.
  for (const surface of surfaceRoles) {
    assert.ok(
      contrastRatio(themeTokens[scheme].textFaint, themeTokens[scheme][surface]) <
        4.5,
      `${scheme}.textFaint is contrast-safe for text — fold it into textMuted instead`,
    );
  }

  // Text that sits on a filled control, not on a surface.
  assert.ok(
    contrastRatio(
      themeTokens[scheme].accentOnPrimary,
      themeTokens[scheme].accentPrimary,
    ) >= 4.5,
    `${scheme} accent label fails on its own fill`,
  );
  assert.ok(
    contrastRatio(
      themeTokens[scheme].controlOnFill,
      themeTokens[scheme].controlFill,
    ) >= 4.5,
    `${scheme} control label fails on its own fill`,
  );
}

console.log("design-system theme token self-check: OK");

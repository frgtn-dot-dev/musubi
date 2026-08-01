import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

console.log("design-system theme token self-check: OK");

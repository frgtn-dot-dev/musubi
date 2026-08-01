import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderThemeTokensCss } from "./css";
import { themeTokens } from "./theme-tokens";

const generatedCssPath = fileURLToPath(
  new URL("./colors.css", import.meta.url),
);

assert.equal(
  readFileSync(generatedCssPath, "utf8"),
  renderThemeTokensCss(),
  "The committed web representation must match the canonical theme tokens",
);

assert.deepEqual(
  Object.keys(themeTokens.light),
  Object.keys(themeTokens.dark),
  "Light and dark themes must expose the same semantic roles",
);

console.log("design-system theme token self-check: OK");

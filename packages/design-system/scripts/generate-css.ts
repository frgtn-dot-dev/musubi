import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderFoundationTokensCss,
  renderThemeTokensCss,
} from "../src/css";
import { penpotTokens } from "../src/penpot-tokens";

const outputs = [
  ["../src/colors.css", renderThemeTokensCss()],
  ["../src/foundations.css", renderFoundationTokensCss()],
  // The same values in the shape a design tool imports. Generated beside the CSS
  // so the two can never describe different tokens.
  [
    "../design-tokens.json",
    `${JSON.stringify(penpotTokens(), null, 2)}\n`,
  ],
] as const;

for (const [relativePath, content] of outputs) {
  const outputPath = fileURLToPath(new URL(relativePath, import.meta.url));
  writeFileSync(outputPath, content);
  console.log(`Generated ${outputPath}`);
}

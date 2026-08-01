import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderFoundationTokensCss,
  renderThemeTokensCss,
} from "../src/css";

const outputs = [
  ["../src/colors.css", renderThemeTokensCss()],
  ["../src/foundations.css", renderFoundationTokensCss()],
] as const;

for (const [relativePath, content] of outputs) {
  const outputPath = fileURLToPath(new URL(relativePath, import.meta.url));
  writeFileSync(outputPath, content);
  console.log(`Generated ${outputPath}`);
}

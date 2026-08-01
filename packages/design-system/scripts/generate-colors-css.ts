import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderThemeTokensCss } from "../src/css";

const outputPath = fileURLToPath(new URL("../src/colors.css", import.meta.url));

writeFileSync(outputPath, renderThemeTokensCss());
console.log(`Generated ${outputPath}`);

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Logic tests only: the app's own modules that hold rules worth pinning, run in
// node with React Native and Expo mocked at the seam. Rendering React Native
// components would need a whole preset for no gain — the value here is the
// decisions, not the pixels.
//
// `.spec.ts`, not `.test.ts`: the assert-based files next door predate this and
// are run directly by tsx from the root script. One suffix per runner keeps
// either from trying to execute the other's files.
export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
  },
});

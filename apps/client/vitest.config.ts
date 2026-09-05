import path from "node:path";
import { readFileSync } from "node:fs";
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
  plugins: [
    {
      name: "expo-migration-sql",
      load(id) {
        if (id.endsWith(".sql"))
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`;
      },
    },
  ],
  resolve: {
    alias: { "@": root },
  },
  test: {
    // Pinned for the same reason as apps/web: local-time arithmetic must not
    // depend on the machine's zone. Prague observes daylight saving, UTC doesn't.
    env: { TZ: "Europe/Prague" },
    environment: "node",
    server: { deps: { inline: ["drizzle-orm"] } },
    include: ["**/*.spec.ts"],
  },
});

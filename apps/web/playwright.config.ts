import { defineConfig, devices } from "@playwright/test";

// A dev server bound to ::1 only (pnpm dev's default on some hosts) is reached by
// PLAYWRIGHT_ORIGIN="http://[::1]:3000" instead of a second config.
const origin = process.env.PLAYWRIGHT_ORIGIN ?? "http://127.0.0.1:3000";

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  outputDir: "test-results",
  reporter: "list",
  testDir: "./e2e",
  use: {
    baseURL: origin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    reuseExistingServer: true,
    timeout: 60_000,
    // A real page, not /healthz: that route answers before Vite has finished
    // optimizing client deps, so tests would start against a server that still
    // 504s the client entry ("Outdated Optimize Dep").
    url: `${origin}/login`,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              executablePath:
                process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            }
          : undefined,
      },
    },
  ],
});

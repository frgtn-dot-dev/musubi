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
  // Only the first test on each worker is affected: the `/login` probe below
  // answers before Vite has transformed the route graph or optimized client
  // deps, so that first navigation is slow and can be cut short by the reload
  // Vite triggers once it discovers a new dependency. A warm server is not
  // flaky, so a single retry is the whole fix — a genuinely broken test still
  // fails twice.
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  use: {
    baseURL: origin,
    // Same reason as the unit suites: the browser gets one timezone and locale
    // regardless of the machine, and it is one that observes daylight saving.
    locale: "en-GB",
    timezoneId: "Europe/Prague",
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

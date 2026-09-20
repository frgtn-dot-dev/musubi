import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Exercise the container's production chunks with the same HTTP fixtures as
// the full browser suite. Never fall back to a dev server if the container dies.
export default defineConfig({
  ...base,
  grep: /redirects an anonymous Month request to sign in|opens a calendar for a bare \/app request|reads, filters and signs out of the authenticated Month/,
  retries: 0,
  testMatch: "month-read.spec.ts",
  use: {
    ...base.use,
    baseURL: process.env.PLAYWRIGHT_ORIGIN ?? "http://127.0.0.1:4330",
  },
  webServer: undefined,
  workers: 1,
});

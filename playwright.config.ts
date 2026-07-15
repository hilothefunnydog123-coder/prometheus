import { defineConfig, devices } from "@playwright/test";

const requestedPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const port = /^\d{2,5}$/.test(requestedPort) ? requestedPort : "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Sandboxes and CI images often preinstall a Chromium at a different
    // revision than the pinned @playwright/test expects. Point this at that
    // binary to run E2E without downloading browsers; unset = default.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_PORT === undefined,
    timeout: 120_000,
  },
  timeout: 45_000,
});

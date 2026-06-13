import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: undefined,
});

import { defineConfig, devices } from "@playwright/test";

/**
 * These specs are written to be shown, not just run. They walk the paths the
 * client asked about: a real registration with a real Stripe test payment, and
 * a double submission that must not produce two orders.
 *
 * The dev server and the Stripe CLI listener are expected to be running already,
 * because the webhook is part of what is under test and a forwarder that starts
 * and stops per run makes the results harder to trust.
 */
export default defineConfig({
  testDir: "./tests",
  // Reseed first, so a run never inherits the state of the run before it.
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

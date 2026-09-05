import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * Load .env.local into this process before any spec is collected.
 *
 * The specs talk to Postgres directly to assert on rows, and they read
 * `process.env.DATABASE_URL` to do it. Nothing was putting it there: the seed
 * runs in a subprocess with `--env-file`, so the seed always worked, and the
 * suite then passed only in a shell that happened to have the variable exported
 * already. From anywhere else, including a clean checkout and CI, every spec
 * that touches the database failed with `ECONNREFUSED 127.0.0.1:5432` — the
 * default port, which is the tell that the variable was simply absent.
 *
 * Deliberately does not overwrite anything already set, so a CI runner pointing
 * at its own database still wins.
 */
function loadEnv() {
  const file = path.join(__dirname, ".env.local");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // Nothing to load is fine; the environment may already carry it.
  }

  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    // Strip one layer of matching quotes, which is all a .env file ever has.
    process.env[key] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnv();
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

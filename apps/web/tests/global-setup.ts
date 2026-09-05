import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Reseed before every run.
 *
 * These specs were previously reading whatever state the database happened to
 * be in. Run the load test first and Scratch Adventures is nearly full, so the
 * payment spec, which needs two seats in it, fails for a reason that has
 * nothing to do with the code under test. A suite that depends on the order you
 * ran things in is a suite nobody trusts.
 */
export default function globalSetup() {
  const root = path.resolve(__dirname, "..");

  // Resolve tsx's entry point and run it with this same node, rather than the
  // .bin shim. On Windows the shim is a .cmd, and execFileSync refuses to spawn
  // one without a shell.
  const require = createRequire(__filename);
  const tsx = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

  execFileSync(process.execPath,     // --no-families: the suite needs a known, empty starting point. Forty demo
    // families holding seats would move every "seats free" assertion in it. The
    // demo data is for looking at the console, not for testing against.
    [tsx, "--env-file=.env.local", "../../packages/core/scripts/seed.ts", "--snapshot", "--no-families"], {
    cwd: root,
    stdio: "inherit",
  });
}

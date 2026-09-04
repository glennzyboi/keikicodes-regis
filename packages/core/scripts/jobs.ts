/**
 * Run a background job from the command line.
 *
 *   tsx scripts/jobs.ts notify              drain the outbox once
 *   tsx scripts/jobs.ts notify --watch      keep going, every ten seconds
 *   tsx scripts/jobs.ts notify --dry        render and report, send nothing
 *   tsx scripts/jobs.ts reminders           queue today's class reminders
 *   tsx scripts/jobs.ts reminders --days 14 a wider window, useful for a demo
 *   tsx scripts/jobs.ts sweep               release abandoned seat holds
 *   tsx scripts/jobs.ts sweep --dry         show what would be released
 *
 * This is a way to run the jobs, not where they live. The work is in
 * @keiki/core/jobs and the API service schedules exactly the same functions, so
 * what a person runs by hand and what runs on a cron cannot drift apart.
 */
import { sql } from "../src/db";
import { runNotify } from "../src/jobs/notify";
import { runReminders } from "../src/jobs/reminders";
import { runSweep } from "../src/jobs/sweep";

const [, , job, ...rest] = process.argv;
const has = (flag: string) => rest.includes(`--${flag}`);
const value = (flag: string, fallback: number) => {
  const i = rest.indexOf(`--${flag}`);
  return i === -1 ? fallback : Number(rest[i + 1] ?? fallback);
};

async function once(): Promise<void> {
  switch (job) {
    case "notify":
      await runNotify({ dryRun: has("dry") });
      return;
    case "reminders":
      await runReminders({ dryRun: has("dry"), days: value("days", 1) });
      return;
    case "sweep":
      await runSweep({ dryRun: has("dry") });
      return;
    default:
      console.error(`Unknown job "${job ?? ""}". Try: notify, reminders, sweep.`);
      process.exit(2);
  }
}

async function main() {
  await once();

  if (!has("watch")) {
    await sql.end();
    return;
  }

  const every = job === "sweep" ? 60_000 : 10_000;
  console.log(`watching, every ${every / 1000} seconds. Ctrl C to stop.`);
  setInterval(() => {
    once().catch((e) => console.error("job failed", e));
  }, every);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

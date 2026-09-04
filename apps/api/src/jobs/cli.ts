/**
 * The entry point Render's cron jobs call.
 *
 *   node --import tsx src/jobs/cli.ts notify
 *   node --import tsx src/jobs/cli.ts reminders
 *   node --import tsx src/jobs/cli.ts sweep
 *
 * It is four lines of dispatch on purpose. The work lives in @keiki/core/jobs
 * and is the same code the CLI runs by hand, so "it worked when I ran it" and
 * "it works on the schedule" are statements about one thing.
 *
 * Exit codes matter here in a way they do not in a terminal: a cron that always
 * exits zero is a cron nobody is monitoring.
 */
import { sql } from "@keiki/core/db";
import { runNotify } from "@keiki/core/jobs/notify";
import { runReminders } from "@keiki/core/jobs/reminders";
import { runSweep } from "@keiki/core/jobs/sweep";

const job = process.argv[2];

async function main() {
  const started = Date.now();
  let handled = 0;

  switch (job) {
    case "notify":
      handled = await runNotify();
      break;
    case "reminders":
      handled = await runReminders({ days: Number(process.env.REMINDER_DAYS ?? 1) });
      break;
    case "sweep":
      handled = await runSweep();
      break;
    default:
      console.error(`Unknown job "${job ?? ""}". Try: notify, reminders, sweep.`);
      process.exit(2);
  }

  console.log(`[job:${job}] handled ${handled} in ${Date.now() - started}ms`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(`[job:${job}] failed`, err);
  await sql.end().catch(() => {});
  process.exit(1);
});

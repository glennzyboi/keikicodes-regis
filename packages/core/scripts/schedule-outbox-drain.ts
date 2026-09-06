/**
 * Schedule the outbox drain, in the database.
 *
 *   pnpm --filter @keiki/core exec tsx --env-file=../../.env.prod.local \
 *     scripts/schedule-outbox-drain.ts
 *
 * The seat sweeper moved into pg_cron because it was one statement and because
 * a scheduler outside the database can be asleep. The outbox has the same
 * problem and only half of the same solution: sending mail needs HTTP, so it
 * cannot be a plain SQL statement. pg_net closes that gap — the schedule stays
 * in the database, and the work stays in the application, where the templates
 * and the transport live.
 *
 * This is a script rather than a migration on purpose. A migration is committed,
 * and this needs a URL and a shared secret. Putting a secret in the migrations
 * folder would mean putting it in git, which is the mistake this avoids; it is
 * also the reason the job is created by name here and can be re-run to rotate
 * the secret without a schema change.
 *
 * Requires JOB_SECRET and APP_URL. The same JOB_SECRET has to be set on the web
 * deployment, which is what the route compares against.
 */
import { sql } from "../src/db";

const APP_URL = process.env.APP_URL;
const JOB_SECRET = process.env.JOB_SECRET;

if (!APP_URL || !JOB_SECRET) {
  throw new Error("APP_URL and JOB_SECRET must both be set");
}

const JOB_NAME = "drain-notification-outbox";
const url = `${APP_URL.replace(/\/$/, "")}/api/jobs/notify`;

async function main() {
  await sql`create extension if not exists pg_cron`;
  await sql`create extension if not exists pg_net`;

  // Idempotent. A second run replaces the schedule rather than adding another
  // one beside it, which would double every send attempt. The messages
  // themselves would survive that — claiming is FOR UPDATE SKIP LOCKED — but a
  // duplicated job is still a thing nobody would notice until the bill.
  await sql`
    select cron.unschedule(${JOB_NAME})
     where exists (select 1 from cron.job where jobname = ${JOB_NAME})`;

  // The command is built here rather than parameterised, because cron.schedule
  // stores the command as text and executes it later with no parameters of its
  // own. Both values are ours and neither comes from a user, but they are still
  // quoted through Postgres' own literal quoting rather than string concatenated
  // by hand.
  const [{ command }] = await sql<{ command: string }[]>`
    select format(
      'select net.http_post(url := %L, headers := %L::jsonb)',
      ${url},
      ${JSON.stringify({ "content-type": "application/json", "x-job-secret": JOB_SECRET })}
    ) as command`;

  await sql`select cron.schedule(${JOB_NAME}, '* * * * *', ${command})`;

  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job order by jobname`;

  console.log(`Scheduled ${JOB_NAME} → ${url}`);
  console.log("");
  for (const j of jobs) {
    console.log(`  ${j.active ? "on " : "off"}  ${j.schedule.padEnd(12)} ${j.jobname}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});

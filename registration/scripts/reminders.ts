/**
 * Day-of class reminders.
 *
 * Finds every scheduled session happening today in the school's own timezone
 * and queues one reminder per enrolled child. It does not send anything: it
 * writes to the outbox, and scripts/notify.ts delivers.
 *
 *   pnpm reminders            queue today's reminders
 *   pnpm reminders --days 2   queue for the next two days, useful for a demo
 *   pnpm reminders --dry      report what it would queue
 *
 * Safe to run as often as you like. Every reminder carries the dedupe key
 * reminder:<session>:<enrollment>, which is a unique index, so a cron that
 * fires hourly, or two servers both running it, still results in one email per
 * family per session. That is the whole reason the outbox has that column.
 *
 * In production this is a scheduled job at, say, 7am Honolulu time. Locally it
 * runs on demand so a walkthrough can show it working.
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });

const dryRun = process.argv.includes("--dry");
const daysIndex = process.argv.indexOf("--days");
const days = daysIndex === -1 ? 1 : Math.max(1, Number(process.argv[daysIndex + 1] ?? 1));

type Target = {
  session_id: string;
  class_offering_id: string;
  starts_at: Date;
  ends_at: Date;
  seq: number;
  session_total: number;
  title: string;
  school: string;
  timezone: string;
  parent_id: string;
  email: string;
  parent_name: string;
  child_id: string;
  child_name: string;
  enrollment_id: string;
};

function fmt(d: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(d);
}

async function main() {
  // "Today" is the school's today, not the server's. A job running on a box in
  // Europe must not decide it is already tomorrow in Honolulu.
  const targets = await sql<Target[]>`
    select s.id as session_id, s.class_offering_id, s.starts_at, s.ends_at, s.seq,
           (select count(*)::int from sessions t
             where t.class_offering_id = c.id and t.status <> 'cancelled') as session_total,
           c.title, sc.name as school, sc.timezone,
           p.id as parent_id, p.email, p.full_name as parent_name,
           ch.id as child_id, ch.first_name || ' ' || ch.last_name as child_name,
           e.id as enrollment_id
      from sessions s
      join class_offerings c on c.id = s.class_offering_id
      join schools sc on sc.id = c.school_id
      join enrollments e on e.class_offering_id = c.id
       and e.status in ('active', 'cancellation_requested')
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
     where s.status = 'scheduled'
       and (s.starts_at at time zone sc.timezone)::date
             between (now() at time zone sc.timezone)::date
                 and (now() at time zone sc.timezone)::date + ${days - 1}::int
       and s.starts_at >= now()
     order by s.starts_at, p.full_name`;

  if (targets.length === 0) {
    console.log("No sessions in that window with anyone enrolled.");
    await sql.end();
    return;
  }

  let queued = 0;
  let already = 0;

  for (const t of targets) {
    const dedupe = `reminder:${t.session_id}:${t.enrollment_id}`;

    if (dryRun) {
      console.log(`would remind ${t.email} about ${t.title} for ${t.child_name}`);
      continue;
    }

    const [row] = await sql<{ id: string }[]>`
      insert into notifications
        (template, to_address, to_name, payload, parent_id, child_id,
         class_offering_id, session_id, enrollment_id, dedupe_key)
      values
        ('class_reminder', ${t.email}, ${t.parent_name},
         ${JSON.stringify({
           childName: t.child_name,
           className: t.title,
           school: t.school,
           startTime: fmt(t.starts_at, t.timezone, { hour: "numeric", minute: "2-digit" }),
           endTime: fmt(t.ends_at, t.timezone, { hour: "numeric", minute: "2-digit" }),
           sessionNumber: t.seq,
           sessionTotal: t.session_total,
         })}::text::jsonb,
         ${t.parent_id}, ${t.child_id}, ${t.class_offering_id}, ${t.session_id},
         ${t.enrollment_id}, ${dedupe})
      on conflict (dedupe_key) do nothing
      returning id`;

    if (row) queued++;
    else already++;
  }

  if (dryRun) {
    console.log(`\n${targets.length} reminder${targets.length === 1 ? "" : "s"} would be queued.`);
  } else {
    console.log(`Queued ${queued} reminder${queued === 1 ? "" : "s"}.`);
    if (already > 0) {
      console.log(`${already} were already queued, so they were skipped. That is the dedupe key doing its job.`);
    }
    console.log(`Run "pnpm notify" to deliver them.`);
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

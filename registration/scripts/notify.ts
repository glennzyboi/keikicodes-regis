/**
 * The notification worker.
 *
 * Claims due messages, renders them, sends them, records what happened. This is
 * the only thing in the system that talks to an email provider.
 *
 *   pnpm notify           drain the queue once and stop
 *   pnpm notify --watch   keep going, every ten seconds
 *   pnpm notify --dry     render and report, send nothing
 *
 * Three properties worth naming, because they are the reason this is a worker
 * and not an await inside a request:
 *
 *   1. Claiming uses FOR UPDATE SKIP LOCKED, so two workers running at once
 *      take different rows instead of both sending the same email. Same idea as
 *      the seat counter: let Postgres pick the winner.
 *   2. A failure is retried with exponential backoff up to max_attempts, then
 *      parked as failed and left visible in the console rather than discarded.
 *   3. A worker that dies mid-send leaves rows stuck in 'sending'. Those are
 *      requeued after ten minutes, so a crash costs a delay and not a message.
 */
import postgres from "postgres";
import { emailTransport } from "../src/lib/email";
import { render, type TemplateName } from "../src/lib/templates";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
const transport = emailTransport();

const watch = process.argv.includes("--watch");
const dryRun = process.argv.includes("--dry");

type Row = {
  id: string;
  channel: string;
  template: TemplateName;
  to_address: string;
  to_name: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

/** 1m, 4m, 9m, 16m. Long enough to outlast a blip, short enough to matter. */
function backoffMinutes(attempts: number) {
  return Math.min(attempts * attempts, 60);
}

async function drain() {
  const requeued = await sql<{ requeue_stuck_notifications: number }[]>`
    select requeue_stuck_notifications()`;
  if (requeued[0].requeue_stuck_notifications > 0) {
    console.log(`${stamp()} requeued ${requeued[0].requeue_stuck_notifications} stuck`);
  }

  const claimed = dryRun
    ? await sql<Row[]>`
        select id, channel, template, to_address, to_name, payload, attempts, max_attempts
          from notifications
         where status = 'queued' and scheduled_for <= now()
         order by scheduled_for limit 20`
    : await sql<Row[]>`select * from claim_notifications(20)`;

  if (claimed.length === 0) return 0;

  for (const row of claimed) {
    let rendered;
    try {
      rendered = render(row.template, row.payload);
    } catch (e) {
      // A template that cannot render will never render. Do not retry it.
      await sql`update notifications
                   set status = 'failed', last_error = ${`render: ${(e as Error).message}`}
                 where id = ${row.id}`;
      console.log(`${stamp()} RENDER FAILED ${row.template} -> ${row.to_address}`);
      continue;
    }

    if (dryRun) {
      console.log(`${stamp()} would send [${row.template}] to ${row.to_address}`);
      console.log(`           subject: ${rendered.subject}`);
      continue;
    }

    if (row.channel !== "email") {
      // The channel column exists so SMS can be added without a migration. No
      // transport for it yet, so park rather than pretend.
      await sql`update notifications
                   set status = 'failed', last_error = 'no transport for channel'
                 where id = ${row.id}`;
      continue;
    }

    const result = await transport.send({
      to: row.to_address,
      toName: row.to_name,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.ok) {
      await sql`update notifications
                   set status = 'sent', sent_at = now(),
                       provider_message_id = ${result.id}, last_error = null,
                       subject = ${rendered.subject}
                 where id = ${row.id}`;
      console.log(`${stamp()} sent [${row.template}] to ${row.to_address}`);
    } else if (row.attempts >= row.max_attempts) {
      await sql`update notifications
                   set status = 'failed', last_error = ${result.error}
                 where id = ${row.id}`;
      console.log(`${stamp()} GAVE UP [${row.template}] ${row.to_address}: ${result.error}`);
    } else {
      const wait = backoffMinutes(row.attempts);
      await sql`update notifications
                   set status = 'queued', last_error = ${result.error}, locked_at = null,
                       scheduled_for = now() + (${wait} || ' minutes')::interval
                 where id = ${row.id}`;
      console.log(
        `${stamp()} retry in ${wait}m [${row.template}] ${row.to_address}: ${result.error}`,
      );
    }
  }

  return claimed.length;
}

async function main() {
  console.log(`${stamp()} transport: ${transport.name}${dryRun ? " (dry run)" : ""}`);

  let total = 0;
  let batch = await drain();
  total += batch;
  // Keep going while there is work, so a single run empties the queue.
  while (batch === 20) {
    batch = await drain();
    total += batch;
  }
  if (total === 0) console.log(`${stamp()} nothing due`);

  if (!watch) {
    await sql.end();
    return;
  }

  console.log(`${stamp()} watching, every ten seconds. Ctrl C to stop.`);
  setInterval(() => {
    drain().catch((e) => console.error(`${stamp()} drain failed`, e));
  }, 10_000);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

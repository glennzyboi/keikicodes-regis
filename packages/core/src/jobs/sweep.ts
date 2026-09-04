/**
 * Returns seats from abandoned checkouts.
 *
 * A parent who opens Stripe and never pays is holding a seat that another
 * family could use. This is the job that gives it back. In production it runs
 * on a schedule, every minute; here it runs on demand so it can be shown.
 *
 *   pnpm sweep          release expired holds once and report
 *   pnpm sweep --watch  keep running, once a minute
 *   pnpm sweep --dry    show what would be released, change nothing
 *
 * The safety property lives in the database, not here: release_expired_holds()
 * will not touch a hold whose order has been paid. See the migration
 * 20260904080000_sweeper_never_touches_paid.sql for why that matters.
 */
import { sql } from "../db";

export type SweepOptions = {
  /** Show what would be released, change nothing. */
  dryRun?: boolean;
  log?: (line: string) => void;
};

type Pending = {
  title: string;
  order_status: string;
  expires_at: Date;
  child: string;
};

async function preview(): Promise<Pending[]> {
  return sql<Pending[]>`
    select c.title,
           o.status as order_status,
           h.expires_at,
           ch.first_name || ' ' || ch.last_name as child
      from seat_holds h
      join order_items oi on oi.id = h.order_item_id
      join orders o       on o.id = oi.order_id
      join children ch    on ch.id = oi.child_id
      join class_offerings c on c.id = h.class_offering_id
     where h.expires_at < now()
     order by h.expires_at asc`;
}

async function sweepOnce(dryRun: boolean, log: (s: string) => void): Promise<number> {
  const expired = await preview();

  const releasable = expired.filter((h) => h.order_status !== "paid");
  const protectedHolds = expired.filter((h) => h.order_status === "paid");

  if (expired.length === 0) {
    log(`${stamp()} nothing expired`);
    return 0;
  }

  for (const h of releasable) {
    log(`${stamp()} expired  ${h.child} in ${h.title} (order ${h.order_status})`);
  }
  for (const h of protectedHolds) {
    log(`${stamp()} PROTECTED ${h.child} in ${h.title}: order is paid, leaving the seat alone`);
  }

  if (dryRun) {
    log(`${stamp()} dry run, released nothing`);
    return 0;
  }

  const [{ release_expired_holds: released }] = await sql<{ release_expired_holds: number }[]>`
    select release_expired_holds()`;

  log(`${stamp()} released ${released} seat${released === 1 ? "" : "s"}`);

  if (released > 0) {
    const rows = await sql<{ title: string; capacity: number; seats_taken: number }[]>`
      select title, capacity, seats_taken from class_offerings order by title`;
    for (const r of rows) {
      log(`           ${r.title}: ${r.seats_taken}/${r.capacity}`);
    }
  }

  return released;
}

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

/** Release expired holds once. Returns how many seats came back. */
export async function runSweep(opts: SweepOptions = {}): Promise<number> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log ?? ((s: string) => console.log(s));
  return sweepOnce(dryRun, log);
}

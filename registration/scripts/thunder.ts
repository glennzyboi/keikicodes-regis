/**
 * The thundering herd.
 *
 * Registration opens, and every parent who set an alarm hits submit inside the
 * same second. This fires N simultaneous registrations at a class with a fixed
 * number of seats and checks that the arithmetic survives it.
 *
 *   pnpm thunder                     50 parents against Scratch Adventures
 *   pnpm thunder --parents 200       heavier
 *   pnpm thunder --class "Python Starters"
 *
 * What it is proving: seats are taken with a single conditional UPDATE,
 *
 *     update class_offerings set seats_taken = seats_taken + 1
 *      where id = $1 and seats_taken < capacity
 *
 * so the winner is decided by Postgres row locking rather than by anything this
 * application does. There is no read-then-write to lose a race in, so the count
 * of successes can only ever equal the capacity, and the losers are told the
 * class is full instead of being quietly charged for a seat that is gone.
 *
 * ---------------------------------------------------------------------------
 * Why this calls createPendingOrder rather than POSTing to /api/register.
 *
 * It used to POST. Then registration started requiring an account, and every
 * request began coming back 401, so the script reported failure for a reason
 * that had nothing to do with concurrency. Driving fifty authenticated browser
 * sessions from a CLI means reimplementing Supabase's cookie format, which is
 * a lot of fragile plumbing to test a transaction.
 *
 * So this runs the exact transaction the route runs, once per parent, with
 * fifty genuinely different parents. Fifty different ones matters: submissions
 * from the SAME parent are deliberately serialised by a row lock on that
 * parent, which would hide the very race this is meant to expose.
 *
 * The HTTP path is covered separately, by a Playwright test that signs in
 * several real browser contexts and fires them together.
 * ---------------------------------------------------------------------------
 */
import postgres from "postgres";
import { createPendingOrder } from "../src/lib/registration";
import { sql as appSql } from "../src/lib/db";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const parents = Number(arg("parents", "50"));
const className = arg("class", "Scratch Adventures");

async function main() {
  const [cls] = await sql<{ id: string; capacity: number; seats_taken: number }[]>`
    select id, capacity, seats_taken from class_offerings where title = ${className}`;
  if (!cls) throw new Error(`no class called ${className}`);

  const seatsFree = cls.capacity - cls.seats_taken;

  const [{ holds: holdsBefore }] = await sql<{ holds: number }[]>`
    select count(*)::int as holds from seat_holds where class_offering_id = ${cls.id}`;

  console.log(`\n  ${className}`);
  console.log(`  capacity ${cls.capacity}, ${cls.seats_taken} taken, ${seatsFree} free`);
  console.log(`  ${parents} parents about to submit at the same moment\n`);

  const run = Date.now();

  // Real parent rows, one each. Created up front so the timed section contains
  // nothing but the registrations themselves.
  const created = await sql<{ id: string }[]>`
    insert into parents (email, full_name)
    select 'thunder-${sql.unsafe(String(run))}-' || i || '@example.test',
           'Thunder Parent ' || i
      from generate_series(1, ${parents}) as i
    returning id`;

  const started = Date.now();

  // Promise.all, not a loop: they leave together.
  const results = await Promise.all(
    created.map((parent, i) =>
      createPendingOrder(parent.id, {
        idempotencyKey: `thunder-${run}-${i}`,
        registrations: [
          {
            classOfferingId: cls.id,
            child: {
              firstName: `Keiki${i}`,
              lastName: `Thunder${run}`,
              dateOfBirth: "2016-05-05",
            },
          },
        ],
      }).catch((e: unknown) => ({
        ok: false as const,
        reason: "threw" as const,
        detail: (e as Error).message,
      })),
    ),
  );

  const elapsed = Date.now() - started;

  const accepted = results.filter((r) => r.ok).length;
  const full = results.filter((r) => !r.ok && r.reason === "class_full").length;
  const other = results.filter(
    (r) => !r.ok && r.reason !== "class_full",
  ) as { reason: string; detail?: string }[];

  const [after] = await sql<{ capacity: number; seats_taken: number }[]>`
    select capacity, seats_taken from class_offerings where id = ${cls.id}`;

  const [{ holds }] = await sql<{ holds: number }[]>`
    select count(*)::int as holds from seat_holds where class_offering_id = ${cls.id}`;

  console.log(`  ${parents} registrations in ${elapsed}ms\n`);
  console.log(`  accepted            ${accepted}`);
  console.log(`  told class is full  ${full}`);
  console.log(`  anything else       ${other.length}`);
  for (const o of other.slice(0, 5)) console.log(`      ${o.reason} ${o.detail ?? ""}`);

  console.log(`\n  seats_taken         ${after.seats_taken} / ${after.capacity}`);
  console.log(`  live holds          ${holds}`);

  // With more parents than seats, everyone who was not among the winners must
  // have been told the class is full. With fewer, everyone gets in and nothing
  // is refused. Both are correct; only the first is the interesting case.
  const oversubscribed = parents > seatsFree;
  const expectedWinners = Math.min(parents, seatsFree);

  const checks: [string, boolean][] = [
    [
      oversubscribed
        ? `accepted exactly the ${seatsFree} free seats`
        : `accepted all ${parents}, which is fewer than the ${seatsFree} free seats`,
      accepted === expectedWinners,
    ],
    [
      "everyone who missed out was told the class is full",
      full === parents - expectedWinners,
    ],
    ["no request failed for any other reason", other.length === 0],
    ["seats_taken never exceeded capacity", after.seats_taken <= after.capacity],
    [
      oversubscribed ? "the class is now exactly full" : "the counter moved by exactly the winners",
      oversubscribed
        ? after.seats_taken === after.capacity
        : after.seats_taken === cls.seats_taken + accepted,
    ],
    ["one new hold per accepted registration", holds - holdsBefore === accepted],
  ];

  if (!oversubscribed) {
    console.log(
      `  Note: ${parents} parents against ${seatsFree} free seats is not a contended run.\n` +
        `  Use --parents above ${seatsFree} to exercise the capacity guard.\n`,
    );
  }

  console.log("");
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}`);
    if (!passed) allPassed = false;
  }
  console.log("");

  // Both pools: the local one, and the app's shared client that
  // createPendingOrder uses. Without the second the process never exits.
  await sql.end();
  await appSql.end();
  if (!allPassed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  await appSql.end().catch(() => {});
  process.exit(1);
});

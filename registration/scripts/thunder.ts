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
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

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
  const bodies = Array.from({ length: parents }, (_, i) => ({
    idempotencyKey: `thunder-${run}-${i}`,
    parent: { email: `thunder-${run}-${i}@example.test`, fullName: `Parent ${i}` },
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
  }));

  const started = Date.now();

  // Promise.all, not a loop: they leave together.
  const results = await Promise.all(
    bodies.map(async (body) => {
      try {
        const res = await fetch(`${appUrl}/api/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { reason?: string };
        return { status: res.status, reason: json.reason };
      } catch (e) {
        return { status: 0, reason: (e as Error).message };
      }
    }),
  );

  const elapsed = Date.now() - started;

  const accepted = results.filter((r) => r.status === 200).length;
  const full = results.filter((r) => r.status === 409 && r.reason === "class_full").length;
  const other = results.filter((r) => r.status !== 200 && r.reason !== "class_full");

  const [after] = await sql<{ capacity: number; seats_taken: number }[]>`
    select capacity, seats_taken from class_offerings where id = ${cls.id}`;

  const [{ holds }] = await sql<{ holds: number }[]>`
    select count(*)::int as holds from seat_holds where class_offering_id = ${cls.id}`;

  console.log(`  ${parents} requests in ${elapsed}ms\n`);
  console.log(`  accepted            ${accepted}`);
  console.log(`  told class is full  ${full}`);
  console.log(`  anything else       ${other.length}`);
  for (const o of other.slice(0, 5)) console.log(`      HTTP ${o.status} ${o.reason ?? ""}`);

  console.log(`\n  seats_taken         ${after.seats_taken} / ${after.capacity}`);
  console.log(`  live holds          ${holds}`);

  const checks: [string, boolean][] = [
    [`accepted exactly the ${seatsFree} free seats`, accepted === seatsFree],
    ["every other request was told the class is full", full === parents - seatsFree],
    ["no request failed for any other reason", other.length === 0],
    ["seats_taken never exceeded capacity", after.seats_taken <= after.capacity],
    ["the class is now exactly full", after.seats_taken === after.capacity],
    ["one new hold per accepted registration", holds - holdsBefore === accepted],
  ];

  console.log("");
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}`);
    if (!passed) allPassed = false;
  }
  console.log("");

  await sql.end();
  if (!allPassed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

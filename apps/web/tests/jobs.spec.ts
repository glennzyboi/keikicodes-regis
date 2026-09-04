import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { sql, unique, signUpParent, registerAndPay, freeClass, okGrade } from "./helpers";
import type { Browser } from "@playwright/test";

/**
 * The background jobs, run as real processes.
 *
 * These are the parts that make the system automatic rather than manual, and
 * they are the parts nobody watches. Each one is invoked exactly the way a cron
 * would invoke it, and then the database is asked what actually happened.
 */

const root = path.resolve(__dirname, "..");
const require = createRequire(__filename);
const tsx = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

/**
 * Run a background job exactly the way the cron does.
 *
 * One dispatcher rather than three scripts, because the API service schedules
 * the same functions and "it worked when I ran it" should be a statement about
 * the same code that runs at 7am.
 */
function runJob(job: "notify" | "reminders" | "sweep", args: string[] = []) {
  return execFileSync(
    process.execPath,
    [tsx, "--env-file=.env.local", "../../packages/core/scripts/jobs.ts", job, ...args],
    { cwd: root, encoding: "utf8" },
  );
}

function runScript(script: string, args: string[] = []) {
  return execFileSync(
    process.execPath,
    [tsx, "--env-file=.env.local", `../../packages/core/scripts/${script}`, ...args],
    { cwd: root, encoding: "utf8" },
  );
}

test.describe("the notification worker", () => {
  test("delivers queued mail and records the provider id", async ({ page }) => {
    const email = `${unique("worker")}@example.test`;
    await signUpParent(page, email, "Worker Family");
    const target = await freeClass(1);
    await registerAndPay(page, target, {
      first: "Mailed",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2015-02-02",
    });

    const [queued] = await sql<{ id: string; status: string }[]>`
      select n.id, n.status from notifications n
        join parents p on p.id = n.parent_id
       where p.email = ${email} and n.template = 'registration_confirmed'`;
    expect(queued.status, "fulfilment queues rather than sends").toBe("queued");

    const output = runJob("notify");
    expect(output).toContain("sent [registration_confirmed]");

    const [after] = await sql<
      { status: string; provider_message_id: string | null; sent_at: Date | null; subject: string | null }[]
    >`select status, provider_message_id, sent_at, subject
        from notifications where id = ${queued.id}`;

    expect(after.status).toBe("sent");
    expect(after.sent_at).not.toBeNull();
    expect(after.provider_message_id, "the transport returned an id").toBeTruthy();
    expect(after.subject, "the subject is stored once rendered").toContain("registered");
  });

  test("draining twice leaves nothing to send", async () => {
    // Drain whatever is outstanding first. Other specs queue mail as a side
    // effect of registering, so asserting on a single run would be asserting
    // about the order the files happened to run in.
    runJob("notify");
    const second = runJob("notify");
    expect(second).toContain("nothing due");

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
       where status = 'queued' and scheduled_for <= now()`;
    expect(n, "the queue is empty after a drain").toBe(0);
  });

  test("a cancelled message is not delivered", async () => {
    const [target] = await sql<{ id: string }[]>`
      insert into notifications (template, to_address, payload, status, dedupe_key)
      values ('class_reminder', 'stopped@example.test',
              '{"childName":"Stop","className":"Test","school":"S","startTime":"3 PM","endTime":"4 PM","sessionNumber":1,"sessionTotal":10}'::jsonb,
              'cancelled', ${unique("stopped")})
      returning id`;

    runJob("notify");

    const [after] = await sql<{ status: string; sent_at: Date | null }[]>`
      select status, sent_at from notifications where id = ${target.id}`;
    expect(after.status).toBe("cancelled");
    expect(after.sent_at).toBeNull();

    await sql`delete from notifications where id = ${target.id}`;
  });
});

test.describe("reminders", () => {
  test("queue once, and never twice however many times the job runs", async () => {
    // Wide enough window to catch the first sessions of the term.
    const first = runJob("reminders", ["--days", "30"]);
    const queuedMatch = first.match(/Queued (\d+) reminder/);
    const queued = Number(queuedMatch?.[1] ?? 0);

    test.skip(queued === 0, "no upcoming sessions with anyone enrolled");

    const [{ n: afterFirst }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'class_reminder'`;

    // Run it twice more. The dedupe key is what stops a cron double sending.
    runJob("reminders", ["--days", "30"]);
    const third = runJob("reminders", ["--days", "30"]);
    expect(third).toContain("Queued 0 reminders");
    expect(third).toContain("already queued");

    const [{ n: afterThird }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'class_reminder'`;
    expect(afterThird, "three runs, one reminder each").toBe(afterFirst);

    // One per family per session, never more.
    const dupes = await sql<{ dedupe_key: string; n: number }[]>`
      select dedupe_key, count(*)::int as n from notifications
       where template = 'class_reminder' and dedupe_key is not null
       group by dedupe_key having count(*) > 1`;
    expect(dupes, "no duplicate reminders").toHaveLength(0);
  });

  test("the dry run changes nothing", async () => {
    const [{ n: before }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications`;
    runJob("reminders", ["--days", "30", "--dry"]);
    const [{ n: after }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications`;
    expect(after).toBe(before);
  });
});

test.describe("the seat sweeper", () => {
  test("releases an abandoned hold and protects a paid one", async () => {
    // Both cases are built here rather than borrowed from whatever the specs
    // before this one happened to leave lying around. Picking "the first paid
    // order" made this test depend on the order the files ran in, and it
    // eventually failed for a reason that had nothing to do with the sweeper.
    const cls = await freeClass(2);

    const [parent] = await sql<{ id: string }[]>`
      insert into parents (email, full_name)
      values (${`${unique("sweep")}@example.test`}, 'Sweep Family')
      returning id`;
    const [child] = await sql<{ id: string }[]>`
      insert into children (parent_id, first_name, last_name, date_of_birth, grade)
      values (${parent.id}, 'Sweep', 'Child', '2016-01-01', ${okGrade(cls)})
      returning id`;

    const make = async (status: string) => {
      const [order] = await sql<{ id: string }[]>`
        insert into orders (parent_id, idempotency_key, status, amount_cents)
        values (${parent.id}, ${unique("sweep-order")}, ${status}, 40000)
        returning id`;
      const [item] = await sql<{ id: string }[]>`
        insert into order_items (order_id, class_offering_id, child_id, unit_price_cents)
        values (${order.id}, ${cls.id}, ${child.id}, 40000)
        returning id`;
      await sql`select take_seat(${cls.id})`;
      return { order_item_id: item.id, class_offering_id: cls.id };
    };

    const paid = await make("paid");
    const pending = await make("pending");

    await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
              values (${paid.order_item_id}, ${paid.class_offering_id},
                      now() - interval '5 minutes')
              on conflict (order_item_id) do update set expires_at = now() - interval '5 minutes'`;

    await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
              values (${pending.order_item_id}, ${pending.class_offering_id},
                      now() - interval '5 minutes')
              on conflict (order_item_id) do update set expires_at = now() - interval '5 minutes'`;

    const [paidSeatsBefore] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${paid.class_offering_id}`;

    const output = runJob("sweep");
    expect(output).toContain("PROTECTED");

    // The paid hold is still there and the seat did not move.
    const stillHeld = await sql<{ id: string }[]>`
      select id from seat_holds where order_item_id = ${paid.order_item_id}`;
    expect(stillHeld, "a paid seat is never swept").toHaveLength(1);

    // Exactly one seat came back: the abandoned one. The paid seat did not move.
    const [paidSeatsAfter] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${paid.class_offering_id}`;
    expect(
      paidSeatsAfter.seats_taken,
      "the abandoned seat came back and the paid one did not",
    ).toBe(paidSeatsBefore.seats_taken - 1);

    // The abandoned one is gone.
    {
      const released = await sql<{ id: string }[]>`
        select id from seat_holds where order_item_id = ${pending.order_item_id}`;
      expect(released, "an abandoned hold is released").toHaveLength(0);
    }

    // Put the class back exactly as it was found. The paid seat this test made
    // is still counted, and leaving it would slowly starve the specs that come
    // after by eating seats nobody can explain.
    await sql`delete from seat_holds where class_offering_id = ${cls.id}
               and order_item_id in (${paid.order_item_id}, ${pending.order_item_id})`;
    await sql`delete from order_items where child_id = ${child.id}`;
    await sql`delete from orders where parent_id = ${parent.id}`;
    await sql`delete from children where id = ${child.id}`;
    await sql`delete from parents where id = ${parent.id}`;
    await sql`update class_offerings set seats_taken = ${cls.seats_taken} where id = ${cls.id}`;
  });
});

test.describe("concurrency", () => {
  test("fifty parents cannot oversell twelve seats", async () => {
    // Its own class, restored afterwards, so filling it does not starve the
    // specs that run later.
    const [target] = await sql<
      { title: string; id: string; seats_taken: number; capacity: number }[]
    >`select title, id, seats_taken, capacity from class_offerings
       where status = 'published' and registration_mode = 'keiki_coders'
       order by capacity - seats_taken desc
       limit 1`;
    const restoreTo = target.seats_taken;

    // Squeeze it to twelve free seats before firing.
    //
    // The contention has to be built, not hoped for. This test once ran against
    // a class with more free seats than there were parents, so every request
    // succeeded, every check passed, and the assertion about the capacity guard
    // was quietly measuring nothing. A concurrency test that cannot fail is
    // worse than no concurrency test.
    const seats = 12;
    await sql`update class_offerings set seats_taken = capacity - ${seats}
               where id = ${target.id}`;

    // By id: five campuses can run a class with this exact title.
    const output = runScript("thunder.ts", ["--parents", "50", "--id", target.id]);

    expect(output, "the run has to be oversubscribed to prove anything").toContain(
      `accepted exactly the ${seats} free seats`,
    );

    // Every check the script makes must pass.
    expect(output, "no check may fail").not.toContain("FAIL");
    expect(output).toContain("PASS  accepted exactly the");
    expect(output).toContain("PASS  seats_taken never exceeded capacity");
    expect(output).toContain("PASS  the class is now exactly full");
    expect(output).toContain("PASS  one new hold per accepted registration");

    // And independently: the counter is at capacity, not past it.
    const [cls] = await sql<{ seats_taken: number; capacity: number }[]>`
      select seats_taken, capacity from class_offerings where id = ${target.id}`;
    expect(cls.seats_taken).toBe(cls.capacity);

    // The database constraint would have refused anything else, but assert it
    // across every class rather than trusting the one under test.
    const oversold = await sql<{ title: string }[]>`
      select title from class_offerings where seats_taken > capacity`;
    expect(oversold, "nothing anywhere is oversold").toHaveLength(0);

    await sql`delete from seat_holds where class_offering_id = ${target.id}`;
    await sql`update class_offerings set seats_taken = ${restoreTo} where id = ${target.id}`;
  });
});

test.describe("concurrency over HTTP", () => {
  test("real signed in sessions racing the endpoint cannot oversell", async ({ browser }) => {
    // A small, genuinely end to end version of thunder: separate browser
    // contexts, each a different signed in parent, all posting at once. The CLI
    // script proves the transaction; this proves the route, the session and the
    // middleware in front of it.
    const cls = await freeClass(4);
    const restoreTo = cls.seats_taken;

    // Squeeze the class down so a handful of contexts can contend for it.
    const seats = 3;
    await sql`update class_offerings set seats_taken = capacity - ${seats}
               where id = ${cls.id}`;

    const contenders = 8;
    const contexts = await Promise.all(
      Array.from({ length: contenders }, () => (browser as Browser).newContext()),
    );

    try {
      // Sign each one in first, so the timed section is only the registrations.
      await Promise.all(
        contexts.map(async (ctx, i) => {
          const page = await ctx.newPage();
          await signUpParent(page, `${unique(`race${i}`)}@example.test`, `Racer ${i}`);
          await page.close();
        }),
      );

      const responses = await Promise.all(
        contexts.map((ctx, i) =>
          ctx.request.post("http://localhost:3000/api/register", {
            data: {
              idempotencyKey: unique(`race-${i}`),
              agreedToPolicies: true,
              registrations: [
                {
                  classOfferingId: cls.id,
                  attendsSchoolConfirmed: true,
                  child: {
                    firstName: `Racer${i}`,
                    lastName: unique("R").replace(/-/g, ""),
                    dateOfBirth: "2015-01-01",
                    grade: okGrade(cls),
                    inAfterschoolCare: false,
                  },
                },
              ],
            },
          }),
        ),
      );

      const accepted = responses.filter((r) => r.status() === 200).length;
      const refused = responses.filter((r) => r.status() === 409).length;
      const other = responses.filter((r) => r.status() !== 200 && r.status() !== 409);

      expect(accepted, `exactly ${seats} should win`).toBe(seats);
      expect(refused, "everyone else is told the class is full").toBe(contenders - seats);
      expect(other, "nobody gets an error").toHaveLength(0);

      const [after] = await sql<{ seats_taken: number; capacity: number }[]>`
        select seats_taken, capacity from class_offerings where id = ${cls.id}`;
      expect(after.seats_taken).toBe(after.capacity);
      expect(after.seats_taken).toBeLessThanOrEqual(after.capacity);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
      // Put the class back, so a spec that runs after this one still finds room.
      await sql`update class_offerings set seats_taken = ${restoreTo}
                 where id = ${cls.id}`;
      await sql`delete from seat_holds where class_offering_id = ${cls.id}`;
    }
  });
});

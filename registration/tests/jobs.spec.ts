import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { sql, unique, signUpParent, registerAndPay, freeClass } from "./helpers";
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

function runScript(script: string, args: string[] = []) {
  return execFileSync(
    process.execPath,
    [tsx, "--env-file=.env.local", `scripts/${script}`, ...args],
    { cwd: root, encoding: "utf8" },
  );
}

test.describe("the notification worker", () => {
  test("delivers queued mail and records the provider id", async ({ page }) => {
    const email = `${unique("worker")}@example.test`;
    await signUpParent(page, email, "Worker Family");
    const target = await freeClass(1);
    await registerAndPay(page, target.id, {
      first: "Mailed",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2015-02-02",
    });

    const [queued] = await sql<{ id: string; status: string }[]>`
      select n.id, n.status from notifications n
        join parents p on p.id = n.parent_id
       where p.email = ${email} and n.template = 'registration_confirmed'`;
    expect(queued.status, "fulfilment queues rather than sends").toBe("queued");

    const output = runScript("notify.ts");
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
    runScript("notify.ts");
    const second = runScript("notify.ts");
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

    runScript("notify.ts");

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
    const first = runScript("reminders.ts", ["--days", "30"]);
    const queuedMatch = first.match(/Queued (\d+) reminder/);
    const queued = Number(queuedMatch?.[1] ?? 0);

    test.skip(queued === 0, "no upcoming sessions with anyone enrolled");

    const [{ n: afterFirst }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'class_reminder'`;

    // Run it twice more. The dedupe key is what stops a cron double sending.
    runScript("reminders.ts", ["--days", "30"]);
    const third = runScript("reminders.ts", ["--days", "30"]);
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
    runScript("reminders.ts", ["--days", "30", "--dry"]);
    const [{ n: after }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications`;
    expect(after).toBe(before);
  });
});

test.describe("the seat sweeper", () => {
  test("releases an abandoned hold and protects a paid one", async () => {
    // An abandoned checkout: a pending order with an expired hold.
    const [pending] = await sql<{ order_item_id: string; class_offering_id: string }[]>`
      select oi.id as order_item_id, oi.class_offering_id
        from order_items oi join orders o on o.id = oi.order_id
       where o.status = 'pending'
       limit 1`;

    // And the dangerous case: an expired hold on an order that is already paid.
    const [paid] = await sql<{ order_item_id: string; class_offering_id: string }[]>`
      select oi.id as order_item_id, oi.class_offering_id
        from order_items oi join orders o on o.id = oi.order_id
       where o.status = 'paid'
       limit 1`;

    test.skip(!paid, "no paid order to protect");

    await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
              values (${paid.order_item_id}, ${paid.class_offering_id},
                      now() - interval '5 minutes')
              on conflict (order_item_id) do update set expires_at = now() - interval '5 minutes'`;

    if (pending) {
      await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
                values (${pending.order_item_id}, ${pending.class_offering_id},
                        now() - interval '5 minutes')
                on conflict (order_item_id) do update set expires_at = now() - interval '5 minutes'`;
    }

    const [paidSeatsBefore] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${paid.class_offering_id}`;

    const output = runScript("sweep-holds.ts");
    expect(output).toContain("PROTECTED");

    // The paid hold is still there and the seat did not move.
    const stillHeld = await sql<{ id: string }[]>`
      select id from seat_holds where order_item_id = ${paid.order_item_id}`;
    expect(stillHeld, "a paid seat is never swept").toHaveLength(1);

    const [paidSeatsAfter] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${paid.class_offering_id}`;
    expect(paidSeatsAfter.seats_taken).toBe(paidSeatsBefore.seats_taken);

    // The abandoned one is gone.
    if (pending) {
      const released = await sql<{ id: string }[]>`
        select id from seat_holds where order_item_id = ${pending.order_item_id}`;
      expect(released, "an abandoned hold is released").toHaveLength(0);
    }

    await sql`delete from seat_holds where order_item_id = ${paid.order_item_id}`;
  });
});

test.describe("concurrency", () => {
  test("fifty parents cannot oversell twelve seats", async () => {
    // Its own class, restored afterwards, so filling it does not starve the
    // specs that run later.
    const [target] = await sql<{ title: string; id: string; seats_taken: number }[]>`
      select title, id, seats_taken from class_offerings
       where status = 'published'
       order by capacity - seats_taken desc
       limit 1`;
    const restoreTo = target.seats_taken;

    const output = runScript("thunder.ts", ["--parents", "50", "--class", target.title]);

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
              registrations: [
                {
                  classOfferingId: cls.id,
                  child: {
                    firstName: `Racer${i}`,
                    lastName: unique("R").replace(/-/g, ""),
                    dateOfBirth: "2015-01-01",
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

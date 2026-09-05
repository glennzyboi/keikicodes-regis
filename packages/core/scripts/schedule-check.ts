/**
 * The schedule engine, driven hard.
 *
 *     pnpm check:schedule
 *
 * Playwright proves the buttons work. This proves the transaction underneath
 * them does, and it reaches things a browser cannot: two staff members editing
 * the same term in the same second, a shift that would land on an occupied
 * date, a make up class surviving a regeneration.
 *
 * Every case runs inside a transaction that is rolled back, so this can be run
 * against a working database as often as you like without disturbing it. The
 * one exception is the concurrency case, which needs two real committed
 * transactions to race, and cleans up after itself.
 *
 * It exits non-zero on the first failure, so it is usable in CI.
 */

import { sql } from "../src/db";
import {
  addSession,
  addDays,
  cancelSessions,
  isoDay,
  moveSession,
  restoreSession,
  shiftSessions,
} from "../src/schedule";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Fixture = {
  offeringId: string;
  timezone: string;
  sessions: { id: string; date: string; status: string; seq: number }[];
};

/**
 * A class with a run of future dates, so moves are not all refused as past.
 *
 * It has to be a class nobody has already edited. Every scenario here rolls
 * back, but the browser suite commits, and it leaves moved dates behind. Pick a
 * class one of those specs has touched and the shift case lands on the date
 * that spec created, the engine correctly refuses it, and this fails for a
 * reason that has nothing to do with shifting. Blackout cancellations do not
 * count as touched: they are the catalogue as published, and excluding them
 * leaves almost nothing to run against.
 */
async function fixture(tx: typeof sql): Promise<Fixture> {
  const [row] = await tx<{ id: string; timezone: string }[]>`
    select c.id, sc.timezone
      from class_offerings c
      join schools sc on sc.id = c.school_id
      join sessions s on s.class_offering_id = c.id
     where c.status = 'published' and s.status = 'scheduled'
       and not exists (
         select 1 from sessions s2
          where s2.class_offering_id = c.id
            and (s2.origin <> 'generated'
                 or s2.status = 'rescheduled'
                 or (s2.status = 'cancelled' and not s2.from_blackout)))
     group by c.id, sc.timezone
    having count(*) filter (where s.starts_at > now()) >= 4
     order by count(*) desc
     limit 1`;
  if (!row) throw new Error("no class has four untouched future sessions; run pnpm seed first");
  return { offeringId: row.id, timezone: row.timezone, sessions: await listSessions(tx, row.id) };
}

async function listSessions(tx: typeof sql, offeringId: string) {
  const rows = await tx<
    { id: string; session_date: string | Date; status: string; seq: number }[]
  >`select id, session_date, status, seq
      from sessions where class_offering_id = ${offeringId} order by session_date`;
  return rows.map((r) => ({
    id: r.id,
    date: isoDay(r.session_date),
    status: r.status,
    seq: r.seq,
  }));
}

function today(f: Fixture) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: f.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Future dates only, because a move into the past is deliberately refused. */
function future(f: Fixture) {
  return f.sessions.filter((s) => s.status === "scheduled" && s.date > today(f));
}

/** Everything still to come, holidays included. What a shift really selects. */
function allFuture(f: Fixture) {
  return f.sessions.filter((s) => s.status !== "rescheduled" && s.date > today(f));
}

/** Run one case inside a transaction and always roll it back. */
async function scenario(label: string, fn: (tx: typeof sql, f: Fixture) => Promise<void>) {
  console.log(`\n${label}`);
  const rollback = Symbol("rollback");
  try {
    await sql.begin(async (tx) => {
      const f = await fixture(tx as unknown as typeof sql);
      await fn(tx as unknown as typeof sql, f);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) {
      failures.push(`${label} threw: ${(err as Error).message}`);
      console.log(`  FAIL  threw: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log("Schedule engine\n===============");

  // -------------------------------------------------------------------------
  await scenario("Cancelling", async (tx, f) => {
    const targets = future(f).slice(0, 3);
    const r = await cancelSessions(tx as never, {
      sessionIds: targets.map((s) => s.id),
      reasonCode: "campus_closed",
      note: "Campus closed all week",
      notify: true,
    });
    check("three dates cancelled in one call", r.ok && r.cancelled === 3);

    const after = await listSessions(tx, f.offeringId);
    const cancelled = after.filter((s) => targets.some((t) => t.id === s.id));
    check(
      "all three are cancelled in the table",
      cancelled.every((s) => s.status === "cancelled"),
    );

    const [reason] = await tx<{ cancel_reason_code: string }[]>`
      select cancel_reason_code from sessions where id = ${targets[0].id}`;
    check("the reason code is stored", reason.cancel_reason_code === "campus_closed");

    const events = await tx<{ n: number }[]>`
      select count(*)::int as n from session_events
       where session_id = any(${targets.map((s) => s.id)}) and event = 'cancelled'`;
    check("one audit row per date", events[0].n === 3);

    // Cancelling the same dates again must not send a second round of email.
    const before = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where class_offering_id = ${f.offeringId}`;
    const again = await cancelSessions(tx as never, {
      sessionIds: targets.map((s) => s.id),
      reasonCode: "campus_closed",
      notify: true,
    });
    const afterCount = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where class_offering_id = ${f.offeringId}`;
    check("cancelling an already cancelled date is refused", !again.ok);
    check("and queues nothing", afterCount[0].n === before[0].n);
  });

  // -------------------------------------------------------------------------
  await scenario("Cancelling then restoring", async (tx, f) => {
    const target = future(f)[0];
    await cancelSessions(tx as never, {
      sessionIds: [target.id],
      reasonCode: "weather",
      notify: false,
    });

    const r = await restoreSession(tx as never, { sessionId: target.id, notify: true });
    check("a cancelled date can be put back", r.ok);

    const [row] = await tx<{ status: string; cancel_reason_code: string | null }[]>`
      select status, cancel_reason_code from sessions where id = ${target.id}`;
    check("it is scheduled again", row.status === "scheduled");
    check("and carries no stale reason", row.cancel_reason_code === null);

    const second = await restoreSession(tx as never, { sessionId: target.id, notify: false });
    check("restoring a running date is refused", !second.ok && second.reason === "not_cancelled");
  });

  // -------------------------------------------------------------------------
  await scenario("Restoring a holiday drops the blackout", async (tx, f) => {
    const target = future(f)[1];
    await tx`insert into offering_blackouts (class_offering_id, blackout_date, reason)
             values (${f.offeringId}, ${target.date}, 'Test holiday')
             on conflict do nothing`;
    await tx`select generate_sessions(${f.offeringId})`;

    const [before] = await tx<{ status: string; from_blackout: boolean }[]>`
      select status, from_blackout from sessions where id = ${target.id}`;
    check("the blackout cancelled the date", before.status === "cancelled" && before.from_blackout);

    const r = await restoreSession(tx as never, { sessionId: target.id, notify: false });
    check("restoring it also removes the blackout", r.ok && r.blackoutRemoved);

    // The real test: regenerate, and it must stay on. Without dropping the
    // blackout the generator would silently cancel it again.
    await tx`select generate_sessions(${f.offeringId})`;
    const [after] = await tx<{ status: string }[]>`
      select status from sessions where id = ${target.id}`;
    check("and it survives a regeneration", after.status === "scheduled");
  });

  // -------------------------------------------------------------------------
  await scenario("Moving one date", async (tx, f) => {
    const target = future(f)[0];
    const to = addDays(target.date, 3);

    const r = await moveSession(tx as never, {
      sessionId: target.id,
      newDate: to,
      reasonCode: "facility",
      note: "Hall is booked",
      notify: true,
    });
    check("the move succeeds", r.ok, r.ok ? "" : r.detail);
    if (!r.ok) return;

    const [replacement] = await tx<
      { session_date: string | Date; origin: string; status: string; rescheduled_from: string }[]
    >`select session_date, origin, status, rescheduled_from
        from sessions where id = ${r.replacementId}`;

    check("the replacement lands on the new date", isoDay(replacement.session_date) === to);
    check("session_date is set", replacement.session_date !== null);
    check("the replacement is manual, so regeneration leaves it", replacement.origin === "manual");
    check("it points back at the date it replaced", replacement.rescheduled_from === target.id);

    const [original] = await tx<{ status: string }[]>`
      select status from sessions where id = ${target.id}`;
    check("the original reads as moved, not cancelled", original.status === "rescheduled");

    // This is the bug that shipped: a replacement marked 'generated' is deleted
    // by the next regeneration, so the move undoes itself.
    await tx`select generate_sessions(${f.offeringId})`;
    const [survives] = await tx<{ n: number }[]>`
      select count(*)::int as n from sessions where id = ${r.replacementId}`;
    check("and it survives a regeneration", survives.n === 1);

    const seqs = (await listSessions(tx, f.offeringId)).map((s) => s.seq);
    check(
      "the run is renumbered without gaps or repeats",
      seqs.every((v, i) => v === i + 1),
      seqs.join(","),
    );
  });

  // -------------------------------------------------------------------------
  await scenario("Moving with a new time", async (tx, f) => {
    const target = future(f)[0];
    const to = addDays(target.date, 2);

    const r = await moveSession(tx as never, {
      sessionId: target.id,
      newDate: to,
      startTime: "09:00",
      endTime: "10:30",
      reasonCode: "instructor_unavailable",
      notify: false,
    });
    check("a move can change the time too", r.ok, r.ok ? "" : r.detail);
    if (!r.ok) return;

    const [row] = await tx<{ local_start: string; local_end: string }[]>`
      select to_char(s.starts_at at time zone sc.timezone, 'HH24:MI') as local_start,
             to_char(s.ends_at   at time zone sc.timezone, 'HH24:MI') as local_end
        from sessions s
        join class_offerings c on c.id = s.class_offering_id
        join schools sc on sc.id = c.school_id
       where s.id = ${r.replacementId}`;
    check("the new time is right in the campus timezone", row.local_start === "09:00", row.local_start);
    check("and so is the end", row.local_end === "10:30", row.local_end);

    const bad = await moveSession(tx as never, {
      sessionId: future(f)[1].id,
      newDate: addDays(future(f)[1].date, 5),
      startTime: "16:00",
      endTime: "15:00",
      reasonCode: "other",
      notify: false,
    });
    check("an end before its start is refused", !bad.ok && bad.reason === "bad_time");

    const half = await moveSession(tx as never, {
      sessionId: future(f)[1].id,
      newDate: addDays(future(f)[1].date, 5),
      startTime: "16:00",
      reasonCode: "other",
      notify: false,
    });
    check("half a time range is refused", !half.ok && half.reason === "bad_time");
  });

  // -------------------------------------------------------------------------
  await scenario("Moves that must be refused", async (tx, f) => {
    const [a, b] = future(f);

    const onto = await moveSession(tx as never, {
      sessionId: a.id,
      newDate: b.date,
      reasonCode: "other",
      notify: false,
    });
    check("moving onto an occupied date is refused", !onto.ok && onto.reason === "date_taken");

    const past = await moveSession(tx as never, {
      sessionId: a.id,
      newDate: "2020-01-06",
      reasonCode: "other",
      notify: false,
    });
    check("moving into the past is refused", !past.ok && past.reason === "in_the_past");

    await cancelSessions(tx as never, {
      sessionIds: [a.id],
      reasonCode: "weather",
      notify: false,
    });
    const dead = await moveSession(tx as never, {
      sessionId: a.id,
      newDate: addDays(a.date, 10),
      reasonCode: "other",
      notify: false,
    });
    check("moving a cancelled date is refused", !dead.ok && dead.reason === "not_scheduled");

    const gone = await moveSession(tx as never, {
      sessionId: "00000000-0000-4000-8000-000000000000",
      newDate: addDays(a.date, 10),
      reasonCode: "other",
      notify: false,
    });
    check("an unknown id is refused, not thrown", !gone.ok && gone.reason === "not_found");
  });

  // -------------------------------------------------------------------------
  await scenario("Shifting a run of dates", async (tx, f) => {
    // Counted as a delta inside the transaction, not as an absolute. A run of
    // the browser suite leaves committed notifications behind, and `enqueue` is
    // idempotent on its dedupe key, so an absolute count sees a row that this
    // call did not create and the arithmetic stops meaning anything.
    const [notesBefore] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where template = 'sessions_shifted' and class_offering_id = ${f.offeringId}`;
    // Everything still to come, cancelled dates included. A weekly class
    // shifted by a week lands each date on the next one, so the whole tail has
    // to move together or nothing can move at all.
    const run = allFuture(f);
    const ids = run.map((s) => s.id);

    const r = await shiftSessions(tx as never, {
      sessionIds: ids,
      byDays: 7,
      reasonCode: "campus_closed",
      note: "Term starts a week late",
      notify: true,
    });
    check("the whole run shifts", r.ok && r.moved === run.length, r.ok ? "" : r.detail);
    if (!r.ok) return;

    const after = await listSessions(tx, f.offeringId);
    const moved = run.every((old) => {
      const now = after.find((s) => s.id === old.id)!;
      return now.date === addDays(old.date, 7);
    });
    check("every date is exactly seven days later", moved);

    const [instants] = await tx<{ local: string }[]>`
      select to_char(s.starts_at at time zone sc.timezone, 'HH24:MI') as local
        from sessions s
        join class_offerings c on c.id = s.class_offering_id
        join schools sc on sc.id = c.school_id
       where s.id = ${ids[0]}`;
    const [original] = await tx<{ local: string }[]>`
      select to_char((${run[0].date}::date + c.start_time), 'HH24:MI') as local
        from class_offerings c where c.id = ${f.offeringId}`;
    check("the time of day is unchanged by the shift", instants.local === original.local,
      `${instants.local} vs ${original.local}`);

    const seqs = after.map((s) => s.seq);
    check("still numbered 1..n", seqs.every((v, i) => v === i + 1), seqs.join(","));

    // One email about the whole shift, not one per date.
    const [notesAfter] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where template = 'sessions_shifted' and class_offering_id = ${f.offeringId}`;
    check(
      "families get one message about the whole shift",
      notesAfter.n - notesBefore.n === r.notified,
      `${notesAfter.n - notesBefore.n} new for ${r.notified} reported`,
    );
  });

  // -------------------------------------------------------------------------
  await scenario("Shifts that must be refused", async (tx, f) => {
    const run = future(f);

    // Shifting only the first date forward by a week lands it on the second.
    const collide = await shiftSessions(tx as never, {
      sessionIds: [run[0].id],
      byDays: 7,
      reasonCode: "other",
      notify: false,
    });
    check("a shift onto a staying date is refused", !collide.ok && collide.reason === "date_taken");

    const before = await listSessions(tx, f.offeringId);
    const backwards = await shiftSessions(tx as never, {
      sessionIds: run.map((s) => s.id),
      byDays: -3650,
      reasonCode: "other",
      notify: false,
    });
    check("a shift into the past is refused", !backwards.ok);

    const after = await listSessions(tx, f.offeringId);
    check(
      "and a refused shift changes nothing at all",
      JSON.stringify(before) === JSON.stringify(after),
    );

    const zero = await shiftSessions(tx as never, {
      sessionIds: run.map((s) => s.id),
      byDays: 0,
      reasonCode: "other",
      notify: false,
    });
    check("shifting by zero days is refused", !zero.ok);

    const none = await shiftSessions(tx as never, {
      sessionIds: [],
      byDays: 7,
      reasonCode: "other",
      notify: false,
    });
    check("shifting nothing is refused", !none.ok && none.reason === "nothing_selected");
  });

  // -------------------------------------------------------------------------
  await scenario("Adding a make up class", async (tx, f) => {
    const last = f.sessions[f.sessions.length - 1];
    const when = addDays(last.date, 10);

    const r = await addSession(tx as never, {
      classOfferingId: f.offeringId,
      date: when,
      startTime: "10:00",
      endTime: "11:00",
      note: "Make up for the storm week",
      notify: true,
    });
    check("an extra date can be added", r.ok, r.ok ? "" : r.detail);
    if (!r.ok) return;

    const [row] = await tx<{ origin: string; status: string }[]>`
      select origin, status from sessions where id = ${r.sessionId}`;
    check("it is manual", row.origin === "manual");
    check("and scheduled", row.status === "scheduled");

    // The point of 'manual': editing the term's end date must not delete it.
    await tx`select generate_sessions(${f.offeringId})`;
    const [survives] = await tx<{ n: number }[]>`
      select count(*)::int as n from sessions where id = ${r.sessionId}`;
    check("a regeneration does not delete it", survives.n === 1);

    const dup = await addSession(tx as never, {
      classOfferingId: f.offeringId,
      date: when,
      notify: false,
    });
    check("a second date on the same day is refused", !dup.ok && dup.reason === "date_taken");

    const past = await addSession(tx as never, {
      classOfferingId: f.offeringId,
      date: "2020-03-04",
      notify: false,
    });
    check("adding a date in the past is refused", !past.ok && past.reason === "in_the_past");
  });

  // -------------------------------------------------------------------------
  await scenario("Notifications are written with the change", async (tx, f) => {
    const target = future(f)[0];
    const [before] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where class_offering_id = ${f.offeringId}`;

    await cancelSessions(tx as never, {
      sessionIds: [target.id],
      reasonCode: "weather",
      note: "Storm warning",
      notify: false,
    });
    const [quiet] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where class_offering_id = ${f.offeringId}`;
    check("notify off really means no email", quiet.n === before.n);

    await restoreSession(tx as never, { sessionId: target.id, notify: false });

    // A delta, not an absolute. The same reason as the shift case above: a
    // committed run of the browser suite can leave a session_cancelled row on
    // this class, and counting every row that exists then measures history
    // rather than what this call just did.
    const [baseline] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where template = 'session_cancelled' and class_offering_id = ${f.offeringId}`;

    await cancelSessions(tx as never, {
      sessionIds: [target.id],
      reasonCode: "weather",
      note: "Storm warning",
      notify: true,
    });
    const [after] = await tx<{ n: number }[]>`
      select count(*)::int as n from notifications
       where template = 'session_cancelled' and class_offering_id = ${f.offeringId}`;
    const loud = { n: after.n - baseline.n };
    const [recipients] = await tx<{ n: number }[]>`
      select count(*)::int as n from enrollments
       where class_offering_id = ${f.offeringId} and status in ('active','cancellation_requested')`;
    check(
      "notify on queues exactly one message per active place",
      loud.n === recipients.n,
      `${loud.n} queued for ${recipients.n} places`,
    );
  });

  // -------------------------------------------------------------------------
  // Two staff members, same class, same second. This one commits, so it uses a
  // scratch offering it creates and deletes.
  // -------------------------------------------------------------------------
  console.log("\nTwo people editing the same term at once");
  {
    const [scratch] = await sql<{ id: string }[]>`
      insert into class_offerings
        (school_id, program_id, term_id, title, weekday, start_time, end_time,
         first_session_date, last_session_date, capacity, price_cents, status,
         registration_mode, registration_opens_at)
      select c.school_id, c.program_id, c.term_id,
             'Schedule race scratch ' || floor(random() * 100000)::text,
             c.weekday, c.start_time, c.end_time,
             c.first_session_date, c.last_session_date, 10, 1000, 'draft',
             'keiki_coders', now()
        from class_offerings c where c.status = 'published' limit 1
      returning id`;

    try {
      await sql`select generate_sessions(${scratch.id})`;
      const rows = await listSessions(sql, scratch.id);
      const target = rows.find((s) => s.status === "scheduled")!;

      // Both try to cancel the same date. One wins; the other must not double
      // the audit trail or the email.
      const [a, b] = await Promise.allSettled([
        sql.begin((tx) =>
          cancelSessions(tx as never, {
            sessionIds: [target.id],
            reasonCode: "weather",
            notify: false,
          }),
        ),
        sql.begin((tx) =>
          cancelSessions(tx as never, {
            sessionIds: [target.id],
            reasonCode: "facility",
            notify: false,
          }),
        ),
      ]);

      const wins = [a, b].filter(
        (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
      ).length;
      check("exactly one of two simultaneous cancellations wins", wins === 1, `${wins} won`);

      const [events] = await sql<{ n: number }[]>`
        select count(*)::int as n from session_events
         where session_id = ${target.id} and event = 'cancelled'`;
      check("and the audit trail has one row, not two", events.n === 1, `${events.n} rows`);

      // Two different dates, aimed at the same free date, at the same moment.
      // The row lock cannot help here: they lock different rows. Only the
      // unique index catches it, and only a savepoint turns that into an
      // answer rather than a 500.
      const open = (await listSessions(sql, scratch.id)).filter(
        (s) => s.status === "scheduled",
      );
      const landing = addDays(open[open.length - 1].date, 21);

      const [x, y] = await Promise.allSettled([
        sql.begin((tx) =>
          moveSession(tx as never, {
            sessionId: open[0].id,
            newDate: landing,
            reasonCode: "facility",
            notify: false,
            allowPast: true,
          }),
        ),
        sql.begin((tx) =>
          moveSession(tx as never, {
            sessionId: open[1].id,
            newDate: landing,
            reasonCode: "facility",
            notify: false,
            allowPast: true,
          }),
        ),
      ]);

      const thrown = [x, y].filter((r) => r.status === "rejected");
      const won = [x, y].filter(
        (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
      );
      const refused = [x, y].filter(
        (r) => r.status === "fulfilled" && !(r.value as { ok: boolean }).ok,
      );

      check("neither racing move crashes", thrown.length === 0);
      check("exactly one lands on the contested date", won.length === 1, `${won.length} landed`);
      check("the other is told why", refused.length === 1);
      if (refused[0]?.status === "fulfilled") {
        const v = refused[0].value as { reason?: string };
        check("and it is told the date is taken", v.reason === "date_taken", String(v.reason));
      }

      const [onDate] = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions
         where class_offering_id = ${scratch.id} and session_date = ${landing}`;
      check("only one session exists on that date", onDate.n === 1, `${onDate.n} rows`);

      // The loser must have rolled back completely: its original date cannot be
      // left marked as moved with nothing to have moved to.
      const [orphans] = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions s
         where s.class_offering_id = ${scratch.id}
           and s.status = 'rescheduled'
           and not exists (select 1 from sessions r where r.rescheduled_from = s.id)`;
      check("the loser left no date marked as moved to nowhere", orphans.n === 0, `${orphans.n}`);
    } finally {
      await sql`delete from sessions where class_offering_id = ${scratch.id}`;
      await sql`delete from class_offerings where id = ${scratch.id}`;
    }
  }

  // -------------------------------------------------------------------------
  console.log("\nInvariants across the whole database");
  const invariants: [string, string][] = [
    [
      "no class has two sessions on one date",
      `select count(*)::int as n from (
         select class_offering_id, session_date from sessions
          group by 1, 2 having count(*) > 1) x`,
    ],
    [
      "every session numbers 1..n within its class",
      `select count(*)::int as n from (
         select class_offering_id from sessions
          group by class_offering_id
         having max(seq) <> count(*) or min(seq) <> 1
             or count(distinct seq) <> count(*)) x`,
    ],
    [
      "no session ends before it starts",
      `select count(*)::int as n from sessions where ends_at <= starts_at`,
    ],
    [
      "every cancelled or moved date says why",
      `select count(*)::int as n from sessions
        where status in ('cancelled','rescheduled') and cancel_reason_code is null`,
    ],
    [
      "every replacement points at a real session",
      `select count(*)::int as n from sessions s
        where s.rescheduled_from is not null
          and not exists (select 1 from sessions o where o.id = s.rescheduled_from)`,
    ],
    [
      "no audit row is orphaned",
      `select count(*)::int as n from session_events e
        where not exists (select 1 from sessions s where s.id = e.session_id)`,
    ],
  ];

  for (const [label, query] of invariants) {
    const [row] = await sql.unsafe<{ n: number }[]>(query);
    check(label, row.n === 0, row.n === 0 ? "" : `${row.n} rows`);
  }

  console.log(
    `\n${passed} checks passed, ${failures.length} failed.` +
      (failures.length ? `\n\n  ${failures.join("\n  ")}\n` : "\n"),
  );

  await sql.end();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

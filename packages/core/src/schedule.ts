import type { Sql, TransactionSql } from "postgres";
import { enqueue, recipientsForClass } from "./notify";

/**
 * The schedule, under an office's hands.
 *
 * What was here before was two buttons that acted on whichever date happened to
 * be next: cancel it, or move it, with a free text note and no record of who
 * did either. That models a school year where nothing ever goes wrong twice.
 * A real term needs week 9 cancelled for a holiday, week 12 moved because the
 * hall is booked, the last four dates pushed a week when the term slips, a make
 * up class added on a Saturday, and week 3 put back after somebody cancelled
 * the wrong one.
 *
 * Three rules run through all of it.
 *
 * **Every change is recorded with a reason and an author.** `session_events` is
 * append only, so "who moved week nine" has an answer in February.
 *
 * **The families are told in the same transaction.** A schedule change that
 * commits without its notifications is worse than one that fails, because
 * nobody finds out until a parent is standing in an empty car park.
 *
 * **Dates are resolved in the campus timezone, in Postgres.** Every instant is
 * built as `(date + time) at time zone tz`, the same expression
 * `generate_sessions` uses, so a hand edit and a regeneration can never
 * disagree about when 3pm is.
 */

// The option lists live in their own import-free module so the forms that
// render them do not drag the database driver into the browser bundle.
export {
  CANCEL_REASONS,
  CANCEL_REASON_LABELS,
  PARENT_CANCEL_REASONS,
  PARENT_CANCEL_REASON_LABELS,
} from "./schedule-reasons";
export type { CancelReasonCode, ParentCancelReasonCode } from "./schedule-reasons";

import type { CancelReasonCode } from "./schedule-reasons";

// ---------------------------------------------------------------------------

export type ScheduleFailure =
  | "not_found"
  | "not_scheduled"
  | "not_cancelled"
  | "date_taken"
  | "in_the_past"
  | "bad_time"
  | "nothing_selected"
  | "too_many";

export type ScheduleResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: ScheduleFailure; detail: string };

const fail = (reason: ScheduleFailure, detail: string) =>
  ({ ok: false as const, reason, detail });

/** One edit may touch at most this many dates. A whole term is about twenty. */
const MAX_BATCH = 60;

type Ctx = {
  class_offering_id: string;
  title: string;
  school: string;
  timezone: string;
  start_time: string;
  end_time: string;
};

type SessionRow = {
  id: string;
  class_offering_id: string;
  session_date: string;
  seq: number;
  status: string;
  starts_at: Date;
  ends_at: Date;
  from_blackout: boolean;
};

/**
 * Run an insert that might collide, without losing the transaction.
 *
 * The row lock settles who may edit a given date. It cannot settle two people
 * moving two *different* dates onto the same new one at the same moment: both
 * pass their checks, and the second hits the unique index on
 * (class_offering_id, session_date). In Postgres a constraint violation poisons
 * the whole transaction, so without a savepoint the only possible answer is a
 * 500. With one, the collision rolls back to here and becomes the same sentence
 * the pre-flight check would have produced.
 */
async function insertOrClash<T>(
  tx: TransactionSql,
  fn: (sp: TransactionSql) => Promise<T>,
): Promise<T | "clash"> {
  try {
    return (await tx.savepoint((sp) => fn(sp as TransactionSql))) as T;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return "clash";
    throw err;
  }
}

/** Dates come back from the driver as Date objects for a `date` column. */
export function isoDay(value: string | Date): string {
  return value instanceof Date
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
        value.getUTCDate(),
      ).padStart(2, "0")}`
    : String(value).slice(0, 10);
}

/** Today at the campus, so "the past" means the past there rather than here. */
export function todayAt(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function whenAt(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(instant);
}

/** YYYY-MM-DD plus a whole number of days, without touching a local Date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return isoDay(at);
}

/**
 * Read the dates about to be edited, and hold them.
 *
 * `for update` is the whole point. Without it every operation here was a read,
 * a decision, and then a write, which two staff members hitting the same button
 * in the same second both pass: the concurrency case in `schedule-check.ts`
 * had both cancellations succeed and wrote the audit trail twice. Under READ
 * COMMITTED the lock makes the second transaction wait and then re-read the row
 * the first one just committed, so it sees 'cancelled' and refuses, which is
 * the same trick `take_seat` uses to stop a class overselling.
 *
 * Ordered by date so two concurrent edits always take their locks in the same
 * order and cannot deadlock against each other.
 */
async function loadSessions(
  tx: TransactionSql | Sql,
  ids: string[],
): Promise<SessionRow[]> {
  const rows = await tx<SessionRow[]>`
    select id, class_offering_id, session_date, seq, status, starts_at, ends_at,
           from_blackout
      from sessions
     where id = any(${ids})
     order by session_date
       for update`;
  return rows.map((r) => ({ ...r, session_date: isoDay(r.session_date) }));
}

async function contextFor(tx: TransactionSql | Sql, classOfferingId: string) {
  const [ctx] = await tx<Ctx[]>`
    select c.id as class_offering_id, c.title, c.start_time::text, c.end_time::text,
           sc.name as school, sc.timezone
      from class_offerings c
      join schools sc on sc.id = c.school_id
     where c.id = ${classOfferingId}`;
  return ctx ?? null;
}

/** The next date that still stands, so a message can say when to turn up next. */
async function nextStanding(tx: TransactionSql | Sql, classOfferingId: string) {
  const [next] = await tx<{ starts_at: Date }[]>`
    select starts_at from sessions
     where class_offering_id = ${classOfferingId}
       and status = 'scheduled' and starts_at >= now()
     order by starts_at asc limit 1`;
  return next?.starts_at ?? null;
}

async function record(
  tx: TransactionSql | Sql,
  event: {
    sessionId: string;
    event: "cancelled" | "restored" | "moved" | "added" | "note_changed";
    reasonCode?: string | null;
    note?: string | null;
    actorId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await tx`insert into session_events (session_id, event, reason_code, note, actor_id, payload)
           values (${event.sessionId}, ${event.event}, ${event.reasonCode ?? null},
                   ${event.note ?? null}, ${event.actorId ?? null},
                   ${JSON.stringify(event.payload ?? {})}::text::jsonb)`;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Stop one or more dates. Everybody keeps their place; only these dates stop.
 *
 * Takes a list because the real request is never "cancel Tuesday". It is "we
 * are closed the whole of that week", and doing that one date at a time sends a
 * family three separate emails about the same closure.
 */
export async function cancelSessions(
  tx: TransactionSql,
  input: {
    sessionIds: string[];
    reasonCode: CancelReasonCode;
    note?: string | null;
    notify: boolean;
    actorId?: string | null;
  },
): Promise<ScheduleResult<{ cancelled: number; notified: number; skipped: number }>> {
  const ids = [...new Set(input.sessionIds)];
  if (ids.length === 0) return fail("nothing_selected", "Choose at least one date.");
  if (ids.length > MAX_BATCH)
    return fail("too_many", `That is more than ${MAX_BATCH} dates in one go.`);

  const rows = await loadSessions(tx, ids);
  if (rows.length === 0) return fail("not_found", "Those dates no longer exist.");

  const live = rows.filter((r) => r.status === "scheduled");
  const skipped = rows.length - live.length;
  if (live.length === 0)
    return fail("not_scheduled", "Every date you chose is already cancelled or moved.");

  const liveIds = live.map((r) => r.id);
  await tx`update sessions
              set status = 'cancelled',
                  cancel_reason_code = ${input.reasonCode},
                  note = ${input.note ?? null},
                  changed_at = now(),
                  changed_by = ${input.actorId ?? null}
            where id = any(${liveIds})`;

  for (const s of live) {
    await record(tx, {
      sessionId: s.id,
      event: "cancelled",
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      payload: { sessionDate: s.session_date, batch: live.length },
    });
  }

  let notified = 0;
  if (input.notify) {
    // Grouped by class: a family in two affected classes gets one message per
    // class, not one per date.
    const byClass = new Map<string, SessionRow[]>();
    for (const s of live) {
      const list = byClass.get(s.class_offering_id) ?? [];
      list.push(s);
      byClass.set(s.class_offering_id, list);
    }

    for (const [classId, list] of byClass) {
      const ctx = await contextFor(tx, classId);
      if (!ctx) continue;
      const next = await nextStanding(tx, classId);
      const dates = list.map((s) => whenAt(new Date(s.starts_at), ctx.timezone));
      // One key for the whole batch, so pressing the button twice on a slow
      // connection cannot send it twice.
      const batchKey = list
        .map((s) => s.id)
        .sort()
        .join(",");

      for (const r of await recipientsForClass(tx, classId)) {
        const id = await enqueue(tx, {
          template: "session_cancelled",
          toAddress: r.email,
          toName: r.parent_name,
          parentId: r.parent_id,
          childId: r.child_id,
          enrollmentId: r.enrollment_id,
          classOfferingId: classId,
          sessionId: list[0].id,
          payload: {
            className: ctx.title,
            school: ctx.school,
            sessionDate: dates.join(", "),
            nextSession: next ? whenAt(new Date(next), ctx.timezone) : null,
            note: input.note ?? null,
          },
          dedupeKey: `session_cancelled:${batchKey}:${r.enrollment_id}`,
        });
        if (id) notified++;
      }
    }
  }

  return { ok: true, cancelled: live.length, notified, skipped };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Put a cancelled date back.
 *
 * There was no way to do this at all, which meant one misclick was permanent
 * and the only fix was a developer with a psql prompt. A date cancelled because
 * of a blackout also drops the blackout, otherwise the next regeneration
 * silently cancels it again and the office thinks the button is broken.
 */
export async function restoreSession(
  tx: TransactionSql,
  input: { sessionId: string; note?: string | null; notify: boolean; actorId?: string | null },
): Promise<ScheduleResult<{ notified: number; blackoutRemoved: boolean }>> {
  const [s] = await loadSessions(tx, [input.sessionId]);
  if (!s) return fail("not_found", "That date no longer exists.");
  if (s.status === "scheduled") return fail("not_cancelled", "That date is already running.");
  if (s.status === "rescheduled")
    return fail(
      "not_cancelled",
      "That date was moved rather than cancelled. Move its replacement back instead.",
    );

  let blackoutRemoved = false;
  if (s.from_blackout) {
    const gone = await tx`delete from offering_blackouts
                           where class_offering_id = ${s.class_offering_id}
                             and blackout_date = ${s.session_date}
                        returning id`;
    blackoutRemoved = gone.length > 0;
  }

  await tx`update sessions
              set status = 'scheduled', cancel_reason_code = null,
                  from_blackout = false, note = ${input.note ?? null},
                  changed_at = now(), changed_by = ${input.actorId ?? null}
            where id = ${s.id}`;

  await record(tx, {
    sessionId: s.id,
    event: "restored",
    note: input.note ?? null,
    actorId: input.actorId ?? null,
    payload: { sessionDate: s.session_date, blackoutRemoved },
  });

  let notified = 0;
  if (input.notify) {
    const ctx = await contextFor(tx, s.class_offering_id);
    if (ctx) {
      for (const r of await recipientsForClass(tx, s.class_offering_id)) {
        const id = await enqueue(tx, {
          template: "session_restored",
          toAddress: r.email,
          toName: r.parent_name,
          parentId: r.parent_id,
          childId: r.child_id,
          enrollmentId: r.enrollment_id,
          classOfferingId: s.class_offering_id,
          sessionId: s.id,
          payload: {
            className: ctx.title,
            school: ctx.school,
            sessionDate: whenAt(new Date(s.starts_at), ctx.timezone),
            note: input.note ?? null,
          },
          dedupeKey: `session_restored:${s.id}:${r.enrollment_id}`,
        });
        if (id) notified++;
      }
    }
  }

  return { ok: true, notified, blackoutRemoved };
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

/**
 * Move a date, and optionally its time.
 *
 * The original row is kept and pointed at by `rescheduled_from` rather than
 * overwritten, so a class that moved twice reads as two moves rather than one
 * mystery. The replacement is `origin = 'manual'`, which is the bit the old
 * code got wrong: a replacement marked 'generated' is deleted by the very next
 * schedule regeneration, so the move would appear to work and then quietly
 * undo itself.
 *
 * It also sets `session_date`, which the old code did not, and which has been
 * NOT NULL since the catalogue migration. Moving a class has therefore been
 * throwing since that migration landed, and no test moved one.
 */
export async function moveSession(
  tx: TransactionSql,
  input: {
    sessionId: string;
    newDate: string;
    /** Both or neither. Leaving them out keeps the time the date already had. */
    startTime?: string | null;
    endTime?: string | null;
    reasonCode: CancelReasonCode;
    note?: string | null;
    notify: boolean;
    actorId?: string | null;
    /** Off for a bulk shift, which checks the whole run up front instead. */
    allowPast?: boolean;
  },
): Promise<ScheduleResult<{ replacementId: string; notified: number }>> {
  const [s] = await loadSessions(tx, [input.sessionId]);
  if (!s) return fail("not_found", "That date no longer exists.");
  if (s.status !== "scheduled")
    return fail("not_scheduled", "That date is already cancelled or moved.");

  const ctx = await contextFor(tx, s.class_offering_id);
  if (!ctx) return fail("not_found", "That class no longer exists.");

  if (!input.allowPast && input.newDate < todayAt(ctx.timezone))
    return fail("in_the_past", "Pick a date from today onwards.");

  const start = input.startTime ?? null;
  const end = input.endTime ?? null;
  if ((start === null) !== (end === null))
    return fail("bad_time", "Give both a start and an end time, or neither.");
  if (start !== null && end !== null && end <= start)
    return fail("bad_time", "The class has to end after it starts.");

  // The unique index on (class_offering_id, session_date) would raise here.
  // Catching it first turns a 500 into a sentence the office can act on.
  const clash = await tx<{ id: string; status: string }[]>`
    select id, status from sessions
     where class_offering_id = ${s.class_offering_id}
       and session_date = ${input.newDate}
       and id <> ${s.id}`;
  if (clash.length > 0)
    return fail(
      "date_taken",
      `This class already has a date on ${input.newDate}. Cancel or move that one first.`,
    );

  // The replacement goes in FIRST, deliberately. Marking the original as moved
  // and then discovering the new date is taken would leave the class with a
  // date that says "moved" and nothing to have moved to. Insert, then mark.
  //
  // Times resolved by Postgres in the campus zone, exactly as generate_sessions
  // does it. seq is set by renumber_sessions once the row exists.
  const inserted = await insertOrClash(tx, (sp) =>
    sp<{ id: string; starts_at: Date }[]>`
      insert into sessions
        (class_offering_id, session_date, seq, starts_at, ends_at, status,
         rescheduled_from, note, origin, from_blackout, changed_at, changed_by)
      select ${s.class_offering_id},
             ${input.newDate}::date,
             (select coalesce(max(seq), 0) + 1 from sessions
               where class_offering_id = ${s.class_offering_id}),
             ((${input.newDate}::date + ${start ?? ctx.start_time}::time) at time zone sc.timezone),
             ((${input.newDate}::date + ${end ?? ctx.end_time}::time)   at time zone sc.timezone),
             'scheduled', ${s.id}, ${input.note ?? null}, 'manual', false,
             now(), ${input.actorId ?? null}
        from class_offerings c join schools sc on sc.id = c.school_id
       where c.id = ${s.class_offering_id}
      returning id, starts_at`,
  );

  if (inserted === "clash")
    return fail(
      "date_taken",
      `Somebody else put a class on ${input.newDate} while you were filling this in. Nothing was changed.`,
    );
  const replacement = inserted[0];

  await tx`update sessions
              set status = 'rescheduled',
                  cancel_reason_code = ${input.reasonCode},
                  note = ${input.note ?? null},
                  changed_at = now(), changed_by = ${input.actorId ?? null}
            where id = ${s.id}`;

  await tx`select renumber_sessions(${s.class_offering_id})`;

  await record(tx, {
    sessionId: s.id,
    event: "moved",
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    actorId: input.actorId ?? null,
    payload: {
      from: s.session_date,
      to: input.newDate,
      replacementId: replacement.id,
      timeChanged: start !== null,
    },
  });

  let notified = 0;
  if (input.notify) {
    for (const r of await recipientsForClass(tx, s.class_offering_id)) {
      const id = await enqueue(tx, {
        template: "session_rescheduled",
        toAddress: r.email,
        toName: r.parent_name,
        parentId: r.parent_id,
        childId: r.child_id,
        enrollmentId: r.enrollment_id,
        classOfferingId: s.class_offering_id,
        sessionId: replacement.id,
        payload: {
          className: ctx.title,
          school: ctx.school,
          oldDate: whenAt(new Date(s.starts_at), ctx.timezone),
          newDate: whenAt(new Date(replacement.starts_at), ctx.timezone),
          timeChanged: start !== null,
          note: input.note ?? null,
        },
        dedupeKey: `session_rescheduled:${replacement.id}:${r.enrollment_id}`,
      });
      if (id) notified++;
    }
  }

  return { ok: true, replacementId: replacement.id, notified };
}

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

/**
 * Push a run of dates by a whole number of days.
 *
 * This is the one the office actually asks for and the old console could not
 * express at all: the term starts a week late, so everything after week 3 moves
 * back seven days. Doing it one date at a time is fifteen forms and fifteen
 * emails, and the fourteenth one lands on the fifteenth one's date and fails.
 *
 * Moved latest first, so a forward shift never collides with a date it is about
 * to vacate. Everything is checked before anything is written, so a run that
 * cannot be shifted cleanly changes nothing at all.
 */
export async function shiftSessions(
  tx: TransactionSql,
  input: {
    sessionIds: string[];
    byDays: number;
    reasonCode: CancelReasonCode;
    note?: string | null;
    notify: boolean;
    actorId?: string | null;
  },
): Promise<ScheduleResult<{ moved: number; notified: number; holesClosed: number }>> {
  const ids = [...new Set(input.sessionIds)];
  if (ids.length === 0) return fail("nothing_selected", "Choose at least one date.");
  if (ids.length > MAX_BATCH)
    return fail("too_many", `That is more than ${MAX_BATCH} dates in one go.`);
  if (!Number.isInteger(input.byDays) || input.byDays === 0)
    return fail("bad_time", "Say how many days to move by.");
  if (Math.abs(input.byDays) > 365)
    return fail("bad_time", "That is more than a year. Edit the class dates instead.");

  // Cancelled dates shift too, and deliberately. "The term starts a week late"
  // moves the holidays with it, and leaving them behind would put the whole run
  // one date out of step with the closures the office already recorded. Only a
  // 'rescheduled' row is left alone: that is the historical marker for a date
  // that already moved, and moving it again would rewrite what parents were
  // told the first time.
  const rows = (await loadSessions(tx, ids)).filter(
    (r) => r.status === "scheduled" || r.status === "cancelled",
  );
  if (rows.length === 0)
    return fail("not_scheduled", "None of the dates you chose can be moved.");

  const classIds = [...new Set(rows.map((r) => r.class_offering_id))];
  const zones = new Map<string, Ctx>();
  for (const id of classIds) {
    const ctx = await contextFor(tx, id);
    if (ctx) zones.set(id, ctx);
  }

  // Check the whole run first. A partial shift is worse than a refusal: half a
  // term moves, the other half does not, and nobody can tell which is which.
  const moving = new Map<string, string>();
  for (const r of rows) {
    const target = addDays(r.session_date, input.byDays);
    const ctx = zones.get(r.class_offering_id);
    if (ctx && target < todayAt(ctx.timezone))
      return fail("in_the_past", `That would put ${r.session_date} in the past.`);
    moving.set(r.id, target);
  }

  const selected = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const target = moving.get(r.id)!;
    // A collision with another date in this same shift is fine: that one is
    // moving out of the way. A collision with a date staying put is not, and
    // the message has to say which kind of date is in the way, because a
    // cancelled holiday looks like an empty slot on the calendar and "that date
    // already has a class" then reads as a lie.
    const [clash] = await tx<{ id: string; status: string }[]>`
      select id, status from sessions
       where class_offering_id = ${r.class_offering_id}
         and session_date = ${target}
         and id <> ${r.id}`;
    if (clash && !selected.has(clash.id))
      return fail(
        "date_taken",
        clash.status === "scheduled"
          ? `Moving ${r.session_date} by ${input.byDays} days lands on ${target}, which already has a class.`
          : `Moving ${r.session_date} by ${input.byDays} days lands on ${target}, which is a ${
              clash.status === "cancelled" ? "cancelled" : "already moved"
            } date on this class. Include it in the selection, or clear it first.`,
      );
  }

  // Latest first when moving forward, earliest first when moving back, so each
  // row's destination is vacated before it is needed.
  const ordered = [...rows].sort((a, b) =>
    input.byDays > 0
      ? b.session_date.localeCompare(a.session_date)
      : a.session_date.localeCompare(b.session_date),
  );

  for (const r of ordered) {
    const target = moving.get(r.id)!;
    await tx`update sessions
                set session_date = ${target}::date,
                    starts_at = starts_at + make_interval(days => ${input.byDays}),
                    ends_at   = ends_at   + make_interval(days => ${input.byDays}),
                    origin = 'manual',
                    -- A holiday that has been hand moved is no longer the
                    -- generator's business. Leaving the flag set would let the
                    -- next regeneration decide the class is running after all,
                    -- because there is no blackout on the date it moved to.
                    from_blackout = false,
                    changed_at = now(), changed_by = ${input.actorId ?? null},
                    note = ${input.note ?? null}
              where id = ${r.id}`;
    await record(tx, {
      sessionId: r.id,
      event: "moved",
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      payload: { from: r.session_date, to: target, byDays: input.byDays, bulk: true },
    });
  }

  // A shift leaves holes, and a hole is not nothing: the class's own schedule
  // still says a class runs on that weekday, so the next regeneration would put
  // a fresh session back on the vacated date and the term would quietly grow by
  // one. Recording the hole as a blackout is what makes a hand shift and a
  // regeneration agree, and it is why a parent sees "no class, moved to a later
  // date" rather than a mystery gap.
  //
  // Found by running a regeneration after a shift rather than by reading the
  // code, which is the only way this sort of thing is ever found.
  const landed = new Set(moving.values());
  let holes = 0;
  for (const r of ordered) {
    if (landed.has(r.session_date)) continue;
    const done = await tx`
      insert into offering_blackouts (class_offering_id, blackout_date, reason)
      values (${r.class_offering_id}, ${r.session_date}, ${
        input.byDays > 0 ? "Moved to a later date" : "Moved to an earlier date"
      })
      on conflict (class_offering_id, blackout_date) do nothing
      returning id`;
    holes += done.length;
  }

  for (const id of classIds) await tx`select renumber_sessions(${id})`;

  let notified = 0;
  if (input.notify) {
    for (const classId of classIds) {
      const ctx = zones.get(classId);
      if (!ctx) continue;
      const mine = ordered.filter((r) => r.class_offering_id === classId);
      const batchKey = mine
        .map((r) => r.id)
        .sort()
        .join(",");
      for (const r of await recipientsForClass(tx, classId)) {
        const id = await enqueue(tx, {
          // sessions_shifted, not schedule_changed. schedule_changed is for a
          // class whose whole schedule was rewritten and it renders `schedule`,
          // `firstSession`, `lastSession` and `childName`, none of which a bulk
          // shift has. Sending it here put the word "undefined" in front of a
          // parent. Caught by a check asserting the message that was queued was
          // the message this function claims to send.
          template: "sessions_shifted",
          toAddress: r.email,
          toName: r.parent_name,
          parentId: r.parent_id,
          childId: r.child_id,
          enrollmentId: r.enrollment_id,
          classOfferingId: classId,
          payload: {
            className: ctx.title,
            school: ctx.school,
            summary: `${mine.length} ${mine.length === 1 ? "date moves" : "dates move"} by ${Math.abs(
              input.byDays,
            )} ${Math.abs(input.byDays) === 1 ? "day" : "days"}`,
            note: input.note ?? null,
          },
          dedupeKey: `schedule_shift:${batchKey}:${input.byDays}:${r.enrollment_id}`,
        });
        if (id) notified++;
      }
    }
  }

  return { ok: true, moved: ordered.length, notified, holesClosed: holes };
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/**
 * Put an extra date on the calendar. A make up class, usually.
 *
 * Marked `origin = 'manual'` so a later regeneration leaves it alone. A make up
 * class that disappears the next time somebody edits the term's end date is
 * worse than not having the feature.
 */
export async function addSession(
  tx: TransactionSql,
  input: {
    classOfferingId: string;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
    note?: string | null;
    notify: boolean;
    actorId?: string | null;
  },
): Promise<ScheduleResult<{ sessionId: string; notified: number }>> {
  const ctx = await contextFor(tx, input.classOfferingId);
  if (!ctx) return fail("not_found", "That class no longer exists.");

  if (input.date < todayAt(ctx.timezone))
    return fail("in_the_past", "Pick a date from today onwards.");

  const start = input.startTime ?? null;
  const end = input.endTime ?? null;
  if ((start === null) !== (end === null))
    return fail("bad_time", "Give both a start and an end time, or neither.");
  if (start !== null && end !== null && end <= start)
    return fail("bad_time", "The class has to end after it starts.");

  const clash = await tx<{ id: string }[]>`
    select id from sessions
     where class_offering_id = ${input.classOfferingId} and session_date = ${input.date}`;
  if (clash.length > 0)
    return fail("date_taken", `This class already has a date on ${input.date}.`);

  const inserted = await insertOrClash(tx, (sp) =>
    sp<{ id: string; starts_at: Date }[]>`
      insert into sessions
        (class_offering_id, session_date, seq, starts_at, ends_at, status,
         note, origin, from_blackout, changed_at, changed_by)
      select ${input.classOfferingId},
             ${input.date}::date,
             (select coalesce(max(seq), 0) + 1 from sessions
               where class_offering_id = ${input.classOfferingId}),
             ((${input.date}::date + ${start ?? ctx.start_time}::time) at time zone sc.timezone),
             ((${input.date}::date + ${end ?? ctx.end_time}::time)   at time zone sc.timezone),
             'scheduled', ${input.note ?? null}, 'manual', false,
             now(), ${input.actorId ?? null}
        from class_offerings c join schools sc on sc.id = c.school_id
       where c.id = ${input.classOfferingId}
      returning id, starts_at`,
  );

  if (inserted === "clash")
    return fail(
      "date_taken",
      `Somebody else put a class on ${input.date} while you were filling this in.`,
    );
  const added = inserted[0];

  await tx`select renumber_sessions(${input.classOfferingId})`;

  await record(tx, {
    sessionId: added.id,
    event: "added",
    note: input.note ?? null,
    actorId: input.actorId ?? null,
    payload: { sessionDate: input.date },
  });

  let notified = 0;
  if (input.notify) {
    for (const r of await recipientsForClass(tx, input.classOfferingId)) {
      const id = await enqueue(tx, {
        template: "session_added",
        toAddress: r.email,
        toName: r.parent_name,
        parentId: r.parent_id,
        childId: r.child_id,
        enrollmentId: r.enrollment_id,
        classOfferingId: input.classOfferingId,
        sessionId: added.id,
        payload: {
          className: ctx.title,
          school: ctx.school,
          sessionDate: whenAt(new Date(added.starts_at), ctx.timezone),
          note: input.note ?? null,
        },
        dedupeKey: `session_added:${added.id}:${r.enrollment_id}`,
      });
      if (id) notified++;
    }
  }

  return { ok: true, sessionId: added.id, notified };
}

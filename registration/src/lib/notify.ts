import type { Sql, TransactionSql } from "postgres";
import { sql } from "./db";
import type { TemplateName, Payload } from "./templates";

/**
 * Enqueueing notifications.
 *
 * Always takes a transaction. That is the whole point: the message is written
 * in the same transaction as the change it describes, so a rolled back
 * cancellation cannot leave forty parents told about it, and a committed one
 * cannot fail to tell them because an email API happened to be down.
 *
 * Delivery is somebody else's problem, specifically scripts/notify.ts.
 */

export type Enqueue = {
  template: TemplateName;
  toAddress: string;
  toName?: string | null;
  subject?: string | null;
  payload: Payload;
  parentId?: string | null;
  childId?: string | null;
  classOfferingId?: string | null;
  sessionId?: string | null;
  enrollmentId?: string | null;
  orderId?: string | null;
  scheduledFor?: Date | null;
  /** Optional but strongly encouraged. Makes the enqueue itself idempotent. */
  dedupeKey?: string | null;
  channel?: "email" | "sms";
};

export async function enqueue(tx: TransactionSql | Sql, n: Enqueue): Promise<string | null> {
  // Dates go over as ISO strings with an explicit cast. Passing a Date object
  // alongside the jsonb cast above confuses the driver's type inference and it
  // tries to serialise the Date as text.
  const [row] = await tx<{ id: string }[]>`
    insert into notifications
      (channel, template, to_address, to_name, subject, payload,
       parent_id, child_id, class_offering_id, session_id, enrollment_id, order_id,
       scheduled_for, dedupe_key)
    values
      (${n.channel ?? "email"}, ${n.template}, ${n.toAddress}, ${n.toName ?? null},
       ${n.subject ?? null}, ${JSON.stringify(n.payload)}::text::jsonb,
       ${n.parentId ?? null}, ${n.childId ?? null}, ${n.classOfferingId ?? null},
       ${n.sessionId ?? null}, ${n.enrollmentId ?? null}, ${n.orderId ?? null},
       ${(n.scheduledFor ?? new Date()).toISOString()}::timestamptz, ${n.dedupeKey ?? null})
    on conflict (dedupe_key) do nothing
    returning id`;

  // Null means this exact message was already queued. That is a success, not a
  // failure: it is what dedupe_key is for.
  return row?.id ?? null;
}

/**
 * Everyone who should hear about something happening to a class.
 *
 * Active places only. A family who cancelled last week does not want the
 * holiday notice, and a seat hold is not a person yet.
 */
export async function recipientsForClass(tx: TransactionSql | Sql, classOfferingId: string) {
  return tx<
    {
      parent_id: string;
      email: string;
      parent_name: string;
      child_id: string;
      child_name: string;
      enrollment_id: string;
    }[]
  >`
    select p.id as parent_id, p.email, p.full_name as parent_name,
           ch.id as child_id, ch.first_name || ' ' || ch.last_name as child_name,
           e.id as enrollment_id
      from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
     where e.class_offering_id = ${classOfferingId}
       and e.status in ('active', 'cancellation_requested')
     order by p.full_name`;
}

/** Formatting helpers shared by every enqueue site, so dates read the same
 *  way in an email as they do on the screen the staff member was looking at. */
export function inSchoolTime(d: Date, timezone = "Pacific/Honolulu") {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(d);
}

export function timeOnly(d: Date, timezone = "Pacific/Honolulu") {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
}

/** Convenience for the reminder job and anything else outside a transaction. */
export const notifications = sql;

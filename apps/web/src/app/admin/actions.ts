"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer, currentStaff } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import { issueRefund } from "@keiki/core/refunds";
import { enqueue, recipientsForClass, inSchoolTime } from "@keiki/core/notify";
import {
  parseForm,
  SignInForm,
  EnrollmentIdForm,
  ApproveCancellationForm,
  CancelSessionForm,
  RescheduleSessionForm,
  SupportNoteForm,
  NotificationIdForm,
  TransferForm,
} from "@keiki/core/forms";

export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const parsed = parseForm(SignInForm, formData);
  if (!parsed.ok) return parsed.error;
  const { email, password } = parsed.data;

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // One message for a wrong password and for an address that does not exist.
  // Telling them apart is a way of asking who works here.
  if (error) return "That email and password do not match.";

  const staff = await currentStaff();
  if (!staff) {
    await supabase.auth.signOut();
    return "That account is not a staff account.";
  }

  redirect("/admin");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

/**
 * Approve a cancellation, free the seat, and send the money back.
 *
 * The refund is issued through Stripe here rather than left as a note for
 * someone to action later, because the step that lives on a sticky note is the
 * step that gets missed. The seat is freed inside the transaction; the Stripe
 * call happens after it commits, so a slow network never holds a row lock.
 */
export async function approveCancellation(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(ApproveCancellationForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId, refundCents } = parsed.data;

  const freed = await asUser(staff.authUserId, async (tx) => {
    const [enrollment] = await tx<{ id: string; class_offering_id: string }[]>`
      update enrollments
         set status = 'cancelled', cancelled_at = now()
       where id = ${enrollmentId} and status = 'cancellation_requested'
      returning id, class_offering_id`;

    if (!enrollment) return false;

    await tx`select release_seat(${enrollment.class_offering_id})`;
    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${enrollment.id}, 'cancellation_approved',
                     ${JSON.stringify({ by: staff.email, refund_cents: refundCents })}::jsonb)`;
    return true;
  });

  // Only refund a cancellation this call actually approved. Without this a
  // second click would try to refund an already cancelled place.
  if (freed && refundCents > 0) {
    await issueRefund(enrollmentId, refundCents, staff.email);
  }

  if (freed) {
    await asUser(staff.authUserId, async (tx) => {
      const [row] = await tx<
        {
          email: string;
          parent_name: string;
          parent_id: string;
          child_name: string;
          title: string;
          paid_cents: number;
        }[]
      >`select p.email, p.full_name as parent_name, p.id as parent_id,
               ch.first_name || ' ' || ch.last_name as child_name,
               c.title, oi.unit_price_cents as paid_cents
          from enrollments e
          join children ch on ch.id = e.child_id
          join parents p on p.id = ch.parent_id
          join class_offerings c on c.id = e.class_offering_id
          join order_items oi on oi.id = e.order_item_id
         where e.id = ${enrollmentId}`;

      if (!row) return;

      await enqueue(tx, {
        template: "cancellation_approved",
        toAddress: row.email,
        toName: row.parent_name,
        parentId: row.parent_id,
        enrollmentId,
        payload: {
          childName: row.child_name,
          className: row.title,
          refundCents,
          paidCents: row.paid_cents,
        },
        dedupeKey: `cancellation_approved:${enrollmentId}`,
      });
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/cancellations");
}

/**
 * The parent changed their mind, or the office said no.
 *
 * The seat was never given up, so this is only a status change and no money
 * moves. That is the whole point of holding the seat through the request.
 */
export async function declineCancellation(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(EnrollmentIdForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    const [enrollment] = await tx<{ id: string }[]>`
      update enrollments
         set status = 'active', refund_owed = false, cancellation_reason = null
       where id = ${enrollmentId} and status = 'cancellation_requested'
      returning id`;
    if (!enrollment) return;

    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${enrollment.id}, 'cancellation_declined',
                     ${JSON.stringify({ by: staff.email })}::jsonb)`;
  });

  revalidatePath("/admin");
}

/** A refund that failed at Stripe, sent again. Same idempotency key, so if the
 *  first attempt did land despite the error, this returns it rather than
 *  paying the family a second time. */
export async function retryRefund(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(ApproveCancellationForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId, refundCents } = parsed.data;

  await issueRefund(enrollmentId, refundCents, staff.email);
  revalidatePath("/admin");
}

/**
 * Close out a refund that was handled outside the system.
 *
 * Kept for the cases automation cannot reach: a payment taken before this
 * system existed, a bank transfer, a credit against next term. It records who
 * decided it was settled rather than silently clearing the flag.
 */
export async function markRefunded(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(EnrollmentIdForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    await tx`update enrollments
                set refund_owed = false, refunded_at = now()
              where id = ${enrollmentId}`;
    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${enrollmentId}, 'refund_marked_paid',
                     ${JSON.stringify({ by: staff.email })}::jsonb)`;
  });

  revalidatePath("/admin");
}

/**
 * Cancel one session of a class. Instructor is sick, campus is closed.
 *
 * The class and everyone's place in it are untouched. Only this date stops.
 */
export async function cancelSession(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(CancelSessionForm, formData);
  if (!parsed.ok) return;
  const { sessionId, note } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    const [session] = await tx<
      {
        id: string;
        class_offering_id: string;
        starts_at: Date;
        title: string;
        school: string;
        timezone: string;
      }[]
    >`update sessions s
         set status = 'cancelled', note = ${note}
        from class_offerings c, schools sc
       where s.id = ${sessionId}
         and s.status = 'scheduled'
         and c.id = s.class_offering_id
         and sc.id = c.school_id
      returning s.id, s.class_offering_id, s.starts_at,
                c.title, sc.name as school, sc.timezone`;

    if (!session) return;

    // The next session that still stands, so the email can tell families when
    // they are next expected rather than leaving them to work it out.
    const [next] = await tx<{ starts_at: Date }[]>`
      select starts_at from sessions
       where class_offering_id = ${session.class_offering_id}
         and status = 'scheduled' and starts_at >= now()
       order by starts_at asc limit 1`;

    // Enqueued in the same transaction as the cancellation. Either the class is
    // cancelled and everyone is told, or neither happened.
    for (const r of await recipientsForClass(tx, session.class_offering_id)) {
      await enqueue(tx, {
        template: "session_cancelled",
        toAddress: r.email,
        toName: r.parent_name,
        parentId: r.parent_id,
        childId: r.child_id,
        enrollmentId: r.enrollment_id,
        classOfferingId: session.class_offering_id,
        sessionId: session.id,
        payload: {
          className: session.title,
          school: session.school,
          sessionDate: inSchoolTime(new Date(session.starts_at), session.timezone),
          nextSession: next ? inSchoolTime(new Date(next.starts_at), session.timezone) : null,
          note,
        },
        dedupeKey: `session_cancelled:${session.id}:${r.enrollment_id}`,
      });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/classes");
}

/**
 * Move a session to another date.
 *
 * The original row is kept and pointed at by rescheduled_from rather than
 * overwritten, so the history of what parents were told still exists. A class
 * that moved twice reads as two moves, not one mystery.
 */
export async function rescheduleSession(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(RescheduleSessionForm, formData);
  if (!parsed.ok) return;
  const { sessionId, newDate, note } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    const [original] = await tx<
      { id: string; class_offering_id: string; seq: number; starts_at: Date; ends_at: Date }[]
    >`select id, class_offering_id, seq, starts_at, ends_at
        from sessions where id = ${sessionId} and status = 'scheduled'`;
    if (!original) return;

    const lengthMs = original.ends_at.getTime() - original.starts_at.getTime();

    // Keep the time of day, move the date. A class that runs 3pm to 4pm still
    // runs 3pm to 4pm on the new day.
    const old = original.starts_at;
    const [y, m, d] = newDate.split("-").map(Number);
    const moved = new Date(old);
    moved.setUTCFullYear(y, m - 1, d);

    await tx`update sessions set status = 'rescheduled', note = ${note}
              where id = ${original.id}`;

    // seq is unique per class, so the replacement takes the next free one
    // rather than reusing the original's and colliding on a second move.
    const [replacement] = await tx<{ id: string }[]>`
      insert into sessions
        (class_offering_id, seq, starts_at, ends_at, status, rescheduled_from, note)
      values (${original.class_offering_id},
              (select coalesce(max(seq), 0) + 1 from sessions
                where class_offering_id = ${original.class_offering_id}),
              ${moved.toISOString()},
              ${new Date(moved.getTime() + lengthMs).toISOString()},
              'scheduled', ${original.id}, ${note})
      returning id`;

    const [ctx] = await tx<{ title: string; school: string; timezone: string }[]>`
      select c.title, sc.name as school, sc.timezone
        from class_offerings c join schools sc on sc.id = c.school_id
       where c.id = ${original.class_offering_id}`;

    for (const r of await recipientsForClass(tx, original.class_offering_id)) {
      await enqueue(tx, {
        template: "session_rescheduled",
        toAddress: r.email,
        toName: r.parent_name,
        parentId: r.parent_id,
        childId: r.child_id,
        enrollmentId: r.enrollment_id,
        classOfferingId: original.class_offering_id,
        sessionId: replacement.id,
        payload: {
          className: ctx.title,
          school: ctx.school,
          oldDate: inSchoolTime(new Date(original.starts_at), ctx.timezone),
          newDate: inSchoolTime(moved, ctx.timezone),
          note,
        },
        dedupeKey: `session_rescheduled:${replacement.id}:${r.enrollment_id}`,
      });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/classes");
}

/**
 * Log a contact with a family.
 *
 * Append only. A note records what someone believed at the time, so a
 * correction is another note rather than an edit that quietly rewrites what the
 * office thought last Tuesday.
 */
export async function addSupportNote(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(SupportNoteForm, formData);
  if (!parsed.ok) return;
  const { parentId, childId, kind, body } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    await tx`insert into support_notes
               (parent_id, child_id, kind, body, author_id, author_email)
             values (${parentId}, ${childId}, ${kind}, ${body}, ${staff.id}, ${staff.email})`;
  });

  revalidatePath(`/admin/families/${parentId}`);
}

/**
 * Put a failed message back on the queue.
 *
 * Resets the attempt counter, because the reason it failed five times is
 * usually now fixed, and leaving it exhausted means it never moves again.
 */
export async function requeueNotification(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsedId = parseForm(NotificationIdForm, formData);
  if (!parsedId.ok) return;
  const id = parsedId.data.notificationId;

  await asUser(staff.authUserId, async (tx) => {
    await tx`update notifications
                set status = 'queued', attempts = 0, locked_at = null,
                    scheduled_for = now(), last_error = null
              where id = ${id} and status in ('failed', 'cancelled')`;
  });

  revalidatePath("/admin/notifications");
  revalidatePath("/admin/families", "layout");
}

/** Stop a queued message that should not go out after all. */
export async function cancelNotification(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsedId = parseForm(NotificationIdForm, formData);
  if (!parsedId.ok) return;
  const id = parsedId.data.notificationId;

  await asUser(staff.authUserId, async (tx) => {
    await tx`update notifications set status = 'cancelled'
              where id = ${id} and status = 'queued'`;
  });

  revalidatePath("/admin/notifications");
}

/**
 * Move a child from one class to another, mid term.
 *
 * The common real request: a clash with swimming, a sibling in a different
 * class, a child who has outgrown the beginner group. Done as one transaction
 * so the seat cannot be released in the old class without being taken in the
 * new one.
 *
 * Money is deliberately not touched. Prices differ between classes, and whether
 * that is a refund, a top up or a goodwill move is a decision for a person, not
 * a rule this function should invent.
 */
export async function transferEnrollment(formData: FormData): Promise<void> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(TransferForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId, toClassId } = parsed.data;

  await asUser(staff.authUserId, async (tx) => {
    const [enrollment] = await tx<
      { id: string; class_offering_id: string; child_id: string }[]
    >`select id, class_offering_id, child_id from enrollments
       where id = ${enrollmentId} and status in ('active','cancellation_requested')
       for update`;
    if (!enrollment) return;

    if (enrollment.class_offering_id === toClassId) return;

    // Same guard as a fresh registration. A transfer must not oversell the
    // class it is moving into.
    const [{ take_seat: got }] = await tx<{ take_seat: boolean }[]>`
      select take_seat(${toClassId})`;
    if (!got) return;

    // The child cannot already hold a live place in the destination.
    const [clash] = await tx<{ id: string }[]>`
      select id from enrollments
       where child_id = ${enrollment.child_id}
         and class_offering_id = ${toClassId}
         and status in ('active','cancellation_requested')`;
    if (clash) {
      await tx`select release_seat(${toClassId})`;
      return;
    }

    // Start them at the next session that has not happened yet, which is what
    // "joining mid semester" means in the schema.
    const [nextSession] = await tx<{ id: string }[]>`
      select id from sessions
       where class_offering_id = ${toClassId} and status = 'scheduled'
         and starts_at >= now()
       order by starts_at asc limit 1`;

    await tx`update enrollments
                set class_offering_id = ${toClassId},
                    starts_from_session_id = ${nextSession?.id ?? null}
              where id = ${enrollmentId}`;

    await tx`select release_seat(${enrollment.class_offering_id})`;

    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${enrollmentId}, 'transferred',
                     ${JSON.stringify({
                       by: staff.email,
                       from: enrollment.class_offering_id,
                       to: toClassId,
                     })}::text::jsonb)`;

  });

  revalidatePath("/admin/families", "layout");
  revalidatePath("/admin/classes", "layout");
}

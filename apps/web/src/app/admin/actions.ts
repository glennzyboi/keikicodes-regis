"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer, currentStaff } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import { issueRefund } from "@keiki/core/refunds";
import { enqueue } from "@keiki/core/notify";
import {
  parseForm,
  SignInForm,
  EnrollmentIdForm,
  ApproveCancellationForm,
  SupportNoteForm,
  NotificationIdForm,
  TransferForm,
  DropForm,
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

// Cancelling and moving a session used to live here as two functions that only
// ever acted on the next date. They are now @keiki/core/schedule, driven from
// ./schedule-actions.ts, because the office needs to reach any date, several at
// once, and to put one back.
//
// The move was also broken: the catalogue migration made sessions.session_date
// NOT NULL and the insert here never set it, so every reschedule threw. No test
// moved a class, so it shipped.

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

/**
 * A child stops coming.
 *
 * Not a cancellation, and the difference is the point. A cancellation is a
 * family asking for something, waiting on a decision, and usually ending in
 * money going back. This is the office writing down that a child stopped
 * attending: it frees the seat immediately, records why and from which session,
 * and leaves the money alone unless somebody separately decides otherwise.
 *
 * Before this there was nowhere to put that. The only way to get a child off a
 * roster was to approve a cancellation, which either paid back money nobody had
 * asked for or, more often, was avoided entirely, so the child stayed on the
 * roster and the seat stayed locked for the rest of the term.
 *
 * The seat is freed inside the same transaction as the status change, exactly
 * as an approved cancellation does, so the counter and the records cannot
 * disagree even if something later in this action throws.
 */
export async function dropFromClass(formData: FormData) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const parsed = parseForm(DropForm, formData);
  if (!parsed.ok) return;
  const { enrollmentId, reasonCode, note, fromSessionId } = parsed.data;

  const done = await asUser(staff.authUserId, async (tx) => {
    // Only a place that is currently held. Dropping an already dropped or
    // cancelled enrollment would release a seat that was released once already,
    // and the counter would drift below the truth.
    const [row] = await tx<{ id: string; class_offering_id: string }[]>`
      update enrollments
         set status = 'dropped',
             dropped_at = now(),
             dropped_reason_code = ${reasonCode},
             dropped_note = ${note},
             dropped_by = ${staff.email},
             dropped_from_session_id = ${fromSessionId}
       where id = ${enrollmentId}
         and status in ('active', 'cancellation_requested')
      returning id, class_offering_id`;

    if (!row) return null;

    await tx`select release_seat(${row.class_offering_id})`;
    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${row.id}, 'dropped',
                     ${JSON.stringify({ by: staff.email, reason: reasonCode, note })}::jsonb)`;
    return row;
  });

  if (done) {
    revalidatePath("/admin/classes", "layout");
    revalidatePath("/admin/students", "layout");
    revalidatePath("/dashboard");
  }
}

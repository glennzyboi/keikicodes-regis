"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer, currentStaff } from "@/lib/staff-auth";
import { asUser } from "@/lib/rls";
import { issueRefund } from "@/lib/refunds";

export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

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

  const enrollmentId = String(formData.get("enrollmentId"));
  const refundCents = Number(formData.get("refundCents") ?? 0);

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

  revalidatePath("/admin");
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

  const enrollmentId = String(formData.get("enrollmentId"));

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

  const enrollmentId = String(formData.get("enrollmentId"));
  const refundCents = Number(formData.get("refundCents") ?? 0);

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

  const enrollmentId = String(formData.get("enrollmentId"));

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

  const sessionId = String(formData.get("sessionId"));
  const note = String(formData.get("note") ?? "").trim() || null;

  await asUser(staff.authUserId, async (tx) => {
    await tx`update sessions set status = 'cancelled', note = ${note}
              where id = ${sessionId} and status = 'scheduled'`;
  });

  revalidatePath("/admin");
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

  const sessionId = String(formData.get("sessionId"));
  const newDate = String(formData.get("newDate") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!newDate) return;

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
    await tx`insert into sessions
               (class_offering_id, seq, starts_at, ends_at, status, rescheduled_from, note)
             values (${original.class_offering_id},
                     (select coalesce(max(seq), 0) + 1 from sessions
                       where class_offering_id = ${original.class_offering_id}),
                     ${moved.toISOString()},
                     ${new Date(moved.getTime() + lengthMs).toISOString()},
                     'scheduled', ${original.id}, ${note})`;
  });

  revalidatePath("/admin");
}

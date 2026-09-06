import { NextResponse } from "next/server";
import { sql } from "@keiki/core/db";
import { ParentDropBody } from "@keiki/core/forms";
import { PARENT_CANCEL_REASON_LABELS } from "@keiki/core/schedule-reasons";
import { currentParent } from "@/lib/parent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A parent drops their child from a class.
 *
 * This is the normal, low-friction exit. The seat is freed immediately and no
 * refund is assumed. If the family believes they are owed money, the separate
 * cancellation path exists for that — or they can ring the office.
 *
 * The difference from the cancel endpoint is the outcome, not the ceremony:
 *   - cancel sets `status = 'cancellation_requested'` and `refund_owed = true`,
 *     then waits for staff to approve.
 *   - drop sets `status = 'dropped'`, releases the seat in the same statement,
 *     and is done.
 *
 * Identity and ownership checks are the same: the session proves who they are
 * and the WHERE clause proves the enrollment is theirs.
 */
export async function POST(req: Request) {
  const parent = await currentParent();
  if (!parent) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const parsed = ParentDropBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0] ?? null;

    const message =
      issue?.code === "invalid_value" || issue?.code === "invalid_union"
        ? "Please choose one of the listed reasons."
        : (issue?.message ?? "Please check the form.");

    return NextResponse.json({ error: "invalid_input", message, field }, { status: 400 });
  }

  const { enrollmentId, reasonCode, note } = parsed.data;

  const summary = PARENT_CANCEL_REASON_LABELS[reasonCode] ?? reasonCode;

  // One transaction: update the enrollment, release the seat, and log the
  // event. If any part fails the whole thing rolls back, so the seat counter
  // and the enrollment status can never disagree.
  const updated = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; class_offering_id: string }[]>`
      update enrollments e
         set status = 'dropped',
             dropped_at = now(),
             dropped_reason_code = ${reasonCode},
             dropped_note = ${note ?? summary},
             dropped_by = 'parent'
        from children ch
       where e.child_id = ch.id
         and e.id = ${enrollmentId}
         and ch.parent_id = ${parent.id}
         and e.status = 'active'
      returning e.id, e.class_offering_id`;

    if (!row) return null;

    await tx`select release_seat(${row.class_offering_id})`;
    await tx`insert into enrollment_events (enrollment_id, event, payload)
             values (${row.id}, 'dropped_by_parent',
                     ${JSON.stringify({
                       by: "parent",
                       reasonCode,
                       note,
                     })}::text::jsonb)`;

    return row;
  });

  if (!updated) {
    return NextResponse.json({ error: "not_yours" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

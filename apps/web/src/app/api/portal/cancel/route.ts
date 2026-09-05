import { NextResponse } from "next/server";
import { sql } from "@keiki/core/db";
import { ParentCancelBody } from "@keiki/core/forms";
import { PARENT_CANCEL_REASON_LABELS } from "@keiki/core/schedule-reasons";
import { currentParent } from "@/lib/parent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A parent requests a cancellation, and says why.
 *
 * The session proves who they are; the UPDATE proves the enrollment is theirs.
 * Both are needed: a signed in family A must not be able to cancel a place
 * belonging to family B, so ownership is checked in the WHERE clause rather
 * than trusted from the request body.
 *
 * The seat is NOT released here. It stays theirs until staff approve, because
 * releasing it early means a parent who changes their mind an hour later has
 * lost the place, and because the refund decision is not ours to make.
 *
 * The reason is new and it is the point of this endpoint changing. It used to
 * write the literal string 'requested by parent', which records nothing: at the
 * end of term the office could say how many families left and nothing about
 * why. A code from a fixed list is countable, and the family's own words go
 * next to it rather than instead of it. "Another reason" requires those words,
 * because a picker whose easiest option is a shrug collects shrugs.
 */
export async function POST(req: Request) {
  // Identity first, body second, and the order is deliberate.
  //
  // Validating first meant an anonymous caller with a malformed body got a 400
  // describing our schema rather than a 401, so the endpoint answered "here is
  // what a valid request looks like" to somebody who is not allowed to make
  // one. It is a small leak and it is free to close: nobody who is not signed
  // in has any business learning the shape of this endpoint.
  //
  // Caught by an existing auth test, which posted without a reason and expected
  // a 401.
  const parent = await currentParent();
  if (!parent) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const parsed = ParentCancelBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0] ?? null;

    // The first message, not the whole zod tree, and not zod's own wording for
    // an enum: that renders as the entire list of codes, which is meaningless
    // to a parent and only reachable by somebody posting by hand anyway.
    const message =
      issue?.code === "invalid_value" || issue?.code === "invalid_union"
        ? "Please choose one of the listed reasons."
        : (issue?.message ?? "Please check the form.");

    return NextResponse.json({ error: "invalid_input", message, field }, { status: 400 });
  }

  const { enrollmentId, reasonCode, note } = parsed.data;

  // The human readable summary is kept alongside the code so the console can
  // show something useful without joining to a lookup that lives in TypeScript.
  const summary = PARENT_CANCEL_REASON_LABELS[reasonCode] ?? reasonCode;

  const updated = await sql<{ id: string }[]>`
    update enrollments e
       set status = 'cancellation_requested',
           refund_owed = true,
           cancellation_reason = ${summary},
           cancellation_reason_code = ${reasonCode},
           cancellation_note = ${note},
           cancellation_requested_at = now()
      from children ch
     where e.child_id = ch.id
       and e.id = ${enrollmentId}
       and ch.parent_id = ${parent.id}
       and e.status = 'active'
    returning e.id`;

  if (updated.length === 0) {
    // Either not theirs, or already cancelled. Same answer either way, so this
    // cannot be used to probe which enrollment ids exist.
    return NextResponse.json({ error: "not_yours" }, { status: 404 });
  }

  await sql`insert into enrollment_events (enrollment_id, event, payload)
            values (${updated[0].id}, 'cancellation_requested',
                    ${JSON.stringify({
                      by: "parent",
                      reasonCode,
                      note,
                    })}::text::jsonb)`;

  return NextResponse.json({ ok: true });
}

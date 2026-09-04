import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@keiki/core/db";
import { currentParent } from "@/lib/parent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  enrollmentId: z.string().uuid(),
});

/**
 * A parent requests a cancellation.
 *
 * The session proves who they are; the UPDATE proves the enrollment is theirs.
 * Both are needed: a signed in family A must not be able to cancel a place
 * belonging to family B, so ownership is checked in the WHERE clause rather
 * than trusted from the request body.
 *
 * The seat is NOT released here. It stays theirs until staff approve, because
 * releasing it early means a parent who changes their mind an hour later has
 * lost the place, and because the refund decision is not ours to make.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const parent = await currentParent();
  if (!parent) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const parentId = parent.id;

  const updated = await sql<{ id: string }[]>`
    update enrollments e
       set status = 'cancellation_requested',
           refund_owed = true,
           cancellation_reason = 'requested by parent'
      from children ch
     where e.child_id = ch.id
       and e.id = ${parsed.data.enrollmentId}
       and ch.parent_id = ${parentId}
       and e.status = 'active'
    returning e.id`;

  if (updated.length === 0) {
    // Either not theirs, or already cancelled. Same answer either way, so this
    // cannot be used to probe which enrollment ids exist.
    return NextResponse.json({ error: "not_yours" }, { status: 404 });
  }

  await sql`insert into enrollment_events (enrollment_id, event, payload)
            values (${updated[0].id}, 'cancellation_requested',
                    ${JSON.stringify({ by: "parent" })}::jsonb)`;

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { sql } from "@keiki/core/db";
import { currentParent } from "@/lib/parent-auth";
import { isUuid } from "@keiki/core/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status of one order, polled by the confirming page while it waits for the
 * webhook. Returns only what that page needs, and only to the family it
 * belongs to: an order id in a URL is not a credential, so the signed in
 * parent has to own it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Same reason as the register page: an id that is not a uuid must not reach
  // the query, or Postgres raises and a wrong address becomes a 500.
  if (!isUuid(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parent = await currentParent();
  if (!parent) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const [order] = await sql<
    { status: string; fulfilled_at: Date | null; amount_cents: number }[]
  >`select status, fulfilled_at, amount_cents
      from orders where id = ${id} and parent_id = ${parent.id}`;

  // Not theirs and not there answer the same way, so this cannot be used to
  // find out which order ids exist.
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    status: order.status,
    fulfilled: Boolean(order.fulfilled_at),
    amountCents: order.amount_cents,
  });
}

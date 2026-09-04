import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createPortalToken } from "@/lib/portal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status of one order, polled by the confirming page while it waits for the
 * webhook. Returns only what that page needs, and hands back a portal token
 * once the order is genuinely fulfilled, never before.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [order] = await sql<
    { id: string; parent_id: string; status: string; fulfilled_at: Date | null; amount_cents: number }[]
  >`select id, parent_id, status, fulfilled_at, amount_cents from orders where id = ${id}`;

  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const fulfilled = Boolean(order.fulfilled_at);

  return NextResponse.json({
    status: order.status,
    fulfilled,
    amountCents: order.amount_cents,
    portalToken: fulfilled ? createPortalToken(order.parent_id) : null,
  });
}

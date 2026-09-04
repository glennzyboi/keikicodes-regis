import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { RegistrationInput, createPendingOrder } from "@/lib/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase one and phase two of a registration.
 *
 *   1. createPendingOrder() resolves the parent and children, creates the order
 *      and its items, and TAKES THE SEATS, all in one transaction.
 *   2. This route then creates a Stripe Checkout Session and hands back its URL.
 *
 * Phase three is the webhook. The redirect back from Stripe is not the
 * confirmation, and this route never pretends it is.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RegistrationInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await createPendingOrder(parsed.data);

  if (!result.ok) {
    // 409, not 400: the request was well formed, the world just changed.
    return NextResponse.json(result, { status: 409 });
  }

  // If this order already has a live checkout session, hand the same one back
  // rather than creating a second. Stripe would happily create two.
  const [order] = await sql<
    { id: string; amount_cents: number; stripe_checkout_session_id: string | null; status: string }[]
  >`select id, amount_cents, stripe_checkout_session_id, status
      from orders where id = ${result.orderId}`;

  if (order.status === "paid") {
    return NextResponse.json({ orderId: order.id, alreadyPaid: true });
  }

  if (order.stripe_checkout_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
    if (existing.status === "open" && existing.url) {
      return NextResponse.json({ orderId: order.id, checkoutUrl: existing.url, reused: true });
    }
  }

  const [payer] = await sql<{ email: string }[]>`
    select p.email from parents p
      join orders o on o.parent_id = p.id
     where o.id = ${order.id}`;

  const items = await sql<
    { stripe_price_id: string | null; unit_price_cents: number; title: string; child: string }[]
  >`select oi.stripe_price_id, oi.unit_price_cents, c.title,
           ch.first_name || ' ' || ch.last_name as child
      from order_items oi
      join class_offerings c on c.id = oi.class_offering_id
      join children ch on ch.id = oi.child_id
     where oi.order_id = ${order.id}`;

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // Line items are built here, on the server, from Stripe price ids we stored
  // when the class was created. Nothing the browser sent can influence what is
  // charged. This is the single most important line in the payment path.
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: items.map((i) => ({ price: i.stripe_price_id!, quantity: 1 })),
      client_reference_id: order.id,
      // They already typed it on our form; do not make them type it again.
      customer_email: payer.email,
      // The classes are priced in USD by a Hawaii business. Adaptive pricing
      // would offer a Manila browser the peso equivalent, which is a different
      // amount from the one the parent agreed to on our own page.
      adaptive_pricing: { enabled: false },
      metadata: { order_id: order.id },
      success_url: `${appUrl}/confirming?order=${order.id}`,
      cancel_url: `${appUrl}/?cancelled=${order.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    // A retried API call returns the same session instead of a second charge.
    { idempotencyKey: `checkout:${order.id}` },
  );

  await sql`update orders set stripe_checkout_session_id = ${session.id}
             where id = ${order.id}`;

  return NextResponse.json({
    orderId: order.id,
    checkoutUrl: session.url,
    reused: result.reused,
  });
}

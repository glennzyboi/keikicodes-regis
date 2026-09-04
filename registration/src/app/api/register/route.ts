import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { RegistrationInput, createPendingOrder } from "@/lib/registration";
import { HOLD_SECONDS } from "@/lib/holds";

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

  // Everything below is serialised per order with a row lock.
  //
  // Without it, a double-clicked submit puts two requests on the same order at
  // the same time, both reach Stripe with idempotency key `checkout:<order>`,
  // and Stripe rejects the second with "another in-progress request is using
  // this idempotent key". That surfaces as a 500 to a parent who did nothing
  // wrong. The lock is on a single order row, so it never blocks another family.
  const checkout = await sql.begin(async (tx) => {
    const [order] = await tx<
      { id: string; stripe_checkout_session_id: string | null; status: string }[]
    >`select id, stripe_checkout_session_id, status
        from orders where id = ${result.orderId}
        for update`;

    if (order.status === "paid") {
      return { orderId: order.id, alreadyPaid: true as const };
    }

    // Whoever got the lock first has already stored a session. Hand back the
    // same one rather than creating a second checkout for the same order.
    if (order.stripe_checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(
        order.stripe_checkout_session_id,
      );
      if (existing.status === "open" && existing.url) {
        return { orderId: order.id, checkoutUrl: existing.url, reused: true };
      }
    }

    const [payer] = await tx<{ email: string }[]>`
      select p.email from parents p
        join orders o on o.parent_id = p.id
       where o.id = ${order.id}`;

    const items = await tx<{ stripe_price_id: string | null }[]>`
      select oi.stripe_price_id
        from order_items oi
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
        // Same lifetime as the seat hold, so the two can never disagree.
        expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
      },
      // A retried API call returns the same session instead of a second charge.
      { idempotencyKey: `checkout:${order.id}` },
    );

    await tx`update orders set stripe_checkout_session_id = ${session.id}
              where id = ${order.id}`;

    return { orderId: order.id, checkoutUrl: session.url, reused: result.reused };
  });

  return NextResponse.json(checkout);
}

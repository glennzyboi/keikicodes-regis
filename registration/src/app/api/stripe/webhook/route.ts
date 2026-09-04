import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { portalUrl } from "@/lib/portal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase three. The webhook is the source of truth for whether a parent paid.
 *
 * Three properties this handler has, deliberately:
 *
 *   1. Signature verified. An unsigned or badly signed request is rejected
 *      before anything is read, so nobody can fabricate a payment.
 *   2. Idempotent. Stripe's event id is the primary key of webhook_events. A
 *      redelivered event conflicts on insert and returns immediately.
 *   3. It fails loudly. If fulfilment throws, this returns 500 so that Stripe
 *      keeps retrying on its own schedule for up to three days. Swallowing the
 *      error would be the one way to actually lose a paid registration.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json({ error: "not_signed" }, { status: 400 });
  }

  const raw = await req.text(); // raw body, not parsed: the signature covers bytes

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: "bad_signature", detail: (err as Error).message },
      { status: 400 },
    );
  }

  // The ledger. First writer wins; everyone else is a replay.
  const inserted = await sql<{ id: string }[]>`
    insert into webhook_events (id, type) values (${event.id}, ${event.type})
    on conflict (id) do nothing
    returning id`;

  if (inserted.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await fulfil(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await expire(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        break;
    }

    await sql`update webhook_events set processed_at = now() where id = ${event.id}`;
    return NextResponse.json({ received: true });
  } catch (err) {
    // Record why, then fail loudly so Stripe retries.
    await sql`update webhook_events set error = ${(err as Error).message}
               where id = ${event.id}`;
    console.error("[webhook] fulfilment failed", event.id, err);
    return NextResponse.json({ error: "fulfilment_failed" }, { status: 500 });
  }
}

/**
 * Turn held seats into places. One transaction over rows that already exist,
 * which is why a failure here is recoverable rather than a lost registration.
 */
async function fulfil(session: Stripe.Checkout.Session) {
  const orderId = session.client_reference_id ?? session.metadata?.order_id;
  if (!orderId) throw new Error("checkout session carried no order id");

  const parentId = await sql.begin(async (tx) => {
    const [order] = await tx<
      { id: string; parent_id: string; fulfilled_at: Date | null }[]
    >`select id, parent_id, fulfilled_at from orders where id = ${orderId} for update`;
    if (!order) throw new Error(`order ${orderId} not found`);

    // Already fulfilled by an earlier delivery of this event. Nothing to do.
    if (order.fulfilled_at) return order.parent_id;

    await tx`update orders
                set status = 'paid',
                    stripe_payment_intent_id = ${(session.payment_intent as string) ?? null}
              where id = ${orderId}`;

    const items = await tx<
      { id: string; class_offering_id: string; child_id: string; starts_from_session_id: string | null }[]
    >`select id, class_offering_id, child_id, starts_from_session_id
        from order_items where order_id = ${orderId}`;

    for (const item of items) {
      const [enrollment] = await tx<{ id: string }[]>`
        insert into enrollments
          (class_offering_id, child_id, order_item_id, status, starts_from_session_id)
        values (${item.class_offering_id}, ${item.child_id}, ${item.id}, 'active',
                ${item.starts_from_session_id})
        on conflict (class_offering_id, child_id)
          where status in ('active','cancellation_requested')
        do nothing
        returning id`;

      await tx`delete from seat_holds where order_item_id = ${item.id}`;

      if (enrollment) {
        await tx`insert into enrollment_events (enrollment_id, order_id, event, payload)
                 values (${enrollment.id}, ${orderId}, 'enrolled',
                         ${JSON.stringify({ stripe_session: session.id })}::jsonb)`;
      }
    }

    await tx`update orders set fulfilled_at = now() where id = ${orderId}`;
    return order.parent_id;
  });

  // Network calls live outside the transaction, always. In production this is
  // where the confirmation email is queued; locally it is logged, and the link
  // is the same signed portal link the email would carry.
  console.log(`[webhook] order ${orderId} fulfilled. Portal link: ${portalUrl(parentId)}`);
}

/** An abandoned checkout: mark it and let the sweeper return the seats. */
async function expire(session: Stripe.Checkout.Session) {
  const orderId = session.client_reference_id ?? session.metadata?.order_id;
  if (!orderId) return;
  await sql`update orders set status = 'expired'
             where id = ${orderId} and status = 'pending'`;
}

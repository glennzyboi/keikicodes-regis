import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { enqueue, inSchoolTime } from "@/lib/notify";

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
      // A refund is not instant. It leaves as pending and Stripe tells us later
      // whether it landed, so the admin reflects what actually happened rather
      // than what we asked for.
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
        await syncRefund(event.data.object as Stripe.Refund);
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
      // Deleting the hold does not decrement the counter: the seat converts
      // from held to enrolled, it is not returned to the pool.
      const removed = await tx<{ id: string }[]>`
        delete from seat_holds where order_item_id = ${item.id} returning id`;

      // No hold means something took it back before we got here. The sweeper
      // no longer does this, but a manual sweep or an older row still can, and
      // the parent has already been charged either way. Try to reclaim the
      // seat. If the class has genuinely filled in the meantime, enrol anyway
      // and flag it: we are not refusing a place to someone who has paid, and
      // an over-capacity class is a conversation for staff, not a silent loss.
      let overCapacity = false;
      if (removed.length === 0) {
        const [{ take_seat: reclaimed }] = await tx<{ take_seat: boolean }[]>`
          select take_seat(${item.class_offering_id})`;
        overCapacity = !reclaimed;
      }

      const [enrollment] = await tx<{ id: string }[]>`
        insert into enrollments
          (class_offering_id, child_id, order_item_id, status, starts_from_session_id)
        values (${item.class_offering_id}, ${item.child_id}, ${item.id}, 'active',
                ${item.starts_from_session_id})
        on conflict (class_offering_id, child_id)
          where status in ('active','cancellation_requested')
        do nothing
        returning id`;

      if (enrollment) {
        await tx`insert into enrollment_events (enrollment_id, order_id, event, payload)
                 values (${enrollment.id}, ${orderId},
                         ${overCapacity ? "enrolled_over_capacity" : "enrolled"},
                         ${JSON.stringify({
                           stripe_session: session.id,
                           hold_missing: removed.length === 0,
                         })}::jsonb)`;
      }
    }

    // The confirmation email is written here, inside the same transaction that
    // creates the enrollments. If this rolls back, nobody is told they are
    // registered when they are not. If it commits, the message is queued and
    // will go out even if the mail provider is down right now.
    const [summary] = await tx<
      {
        email: string;
        parent_name: string;
        class_title: string;
        school: string;
        timezone: string;
        weekday: number;
        start_time: string;
        end_time: string;
        weeks: number;
        amount_cents: number;
        first_session: Date | null;
        children: string[];
      }[]
    >`select p.email, p.full_name as parent_name,
             c.title as class_title, sc.name as school, sc.timezone,
             c.weekday, c.start_time, c.end_time, c.weeks,
             o.amount_cents,
             (select min(ses.starts_at) from sessions ses
               where ses.class_offering_id = c.id and ses.status = 'scheduled') as first_session,
             array_agg(distinct ch.first_name || ' ' || ch.last_name) as children
        from orders o
        join parents p on p.id = o.parent_id
        join order_items oi on oi.order_id = o.id
        join children ch on ch.id = oi.child_id
        join class_offerings c on c.id = oi.class_offering_id
        join schools sc on sc.id = c.school_id
       where o.id = ${orderId}
       group by p.email, p.full_name, c.id, c.title, sc.name, sc.timezone,
                c.weekday, c.start_time, c.end_time, c.weeks, o.amount_cents`;

    if (summary) {
      const days = ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"];
      await enqueue(tx, {
        template: "registration_confirmed",
        toAddress: summary.email,
        toName: summary.parent_name,
        parentId: order.parent_id,
        orderId,
        payload: {
          parentName: summary.parent_name,
          className: summary.class_title,
          school: summary.school,
          children: summary.children,
          schedule: `${days[summary.weekday]} ${summary.start_time.slice(0, 5)} to ${summary.end_time.slice(0, 5)}, ${summary.weeks} weeks`,
          firstSession: summary.first_session
            ? inSchoolTime(new Date(summary.first_session), summary.timezone)
            : "To be confirmed",
          amountCents: summary.amount_cents,
        },
        // One confirmation per order, however many times Stripe redelivers.
        dedupeKey: `registration_confirmed:${orderId}`,
      });
    }

    await tx`update orders set fulfilled_at = now() where id = ${orderId}`;
    return order.parent_id;
  });

  // Nothing to send here. The confirmation was queued inside the transaction
  // above and the worker will deliver it, which is the whole reason there is an
  // outbox rather than an await in the middle of a payment webhook.
  console.log(`[webhook] order ${orderId} fulfilled for parent ${parentId}`);
}

/**
 * Stripe's word on a refund, which outranks ours.
 *
 * refund_owed only clears on succeeded. A refund that fails after we thought it
 * had gone out comes back onto the list here, with the reason attached.
 */
async function syncRefund(refund: Stripe.Refund) {
  const succeeded = refund.status === "succeeded";

  // Stripe sends refund.created and refund.updated for the same refund, often
  // both already succeeded. Only write to the ledger when the status actually
  // moved, so the audit trail reads as a history rather than as noise.
  // RETURNING reports the new row, so the previous status comes from a
  // self-join against the pre-update snapshot instead.
  const updated = await sql<{ id: string; changed: boolean }[]>`
    update enrollments e
       set refund_status = ${refund.status ?? "pending"},
           refund_amount_cents = ${refund.amount},
           refund_owed = ${!succeeded},
           refunded_at = ${succeeded ? sql`now()` : null},
           refund_error = ${refund.failure_reason ?? null}
      from enrollments before
     where before.id = e.id
       and (e.stripe_refund_id = ${refund.id}
            or e.id = ${(refund.metadata?.enrollment_id as string) ?? null})
    returning e.id,
              (before.refund_status is distinct from ${refund.status ?? "pending"}) as changed`;

  if (updated.length === 0 || !updated[0].changed) return;

  await sql`insert into enrollment_events (enrollment_id, event, payload)
            values (${updated[0].id}, 'refund_' || ${refund.status ?? "updated"},
                    ${JSON.stringify({ stripe_refund_id: refund.id, amount_cents: refund.amount })}::jsonb)`;
}

/** An abandoned checkout: mark it and let the sweeper return the seats. */
async function expire(session: Stripe.Checkout.Session) {
  const orderId = session.client_reference_id ?? session.metadata?.order_id;
  if (!orderId) return;
  await sql`update orders set status = 'expired'
             where id = ${orderId} and status = 'pending'`;
}

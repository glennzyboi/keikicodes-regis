import { sql } from "./db";
import { stripe } from "./stripe";

/**
 * Issuing money back.
 *
 * Two rules shape all of this.
 *
 * First, the Stripe call happens outside the database transaction. A network
 * call inside a transaction holds locks for as long as the network feels like
 * taking, and a timeout leaves you unable to tell whether the refund happened.
 * So: record the intent, commit, call Stripe, record the answer.
 *
 * Second, refund_owed stays true until Stripe says succeeded. A refund that
 * fails is louder than one that never started, and the family who was forgotten
 * is the one who phones.
 */

export type RefundQuote = {
  enrollmentId: string;
  child: string;
  title: string;
  paidCents: number;
  sessionsTotal: number;
  sessionsRemaining: number;
  fullCents: number;
  proRataCents: number;
  paymentIntentId: string | null;
};

/**
 * What a refund would be worth, both ways, so the office can choose with the
 * numbers in front of them rather than doing arithmetic in their head.
 *
 * Pro rata is charged on what is left to attend, rounded to the cent in the
 * family's favour. Their real policy is not published anywhere we can see, so
 * this offers both and lets a human decide rather than inventing a rule.
 */
export async function quoteRefund(enrollmentId: string): Promise<RefundQuote | null> {
  const [row] = await sql<
    {
      enrollment_id: string;
      child: string;
      title: string;
      paid_cents: number;
      sessions_total: number;
      sessions_remaining: number;
      payment_intent_id: string | null;
    }[]
  >`
    select e.id as enrollment_id,
           ch.first_name || ' ' || ch.last_name as child,
           c.title,
           oi.unit_price_cents as paid_cents,
           (select count(*)::int from sessions s
             where s.class_offering_id = c.id and s.status <> 'cancelled') as sessions_total,
           (select count(*)::int from sessions s
             where s.class_offering_id = c.id and s.status = 'scheduled'
               and s.starts_at >= now()) as sessions_remaining,
           o.stripe_payment_intent_id as payment_intent_id
      from enrollments e
      join children ch on ch.id = e.child_id
      join class_offerings c on c.id = e.class_offering_id
      join order_items oi on oi.id = e.order_item_id
      join orders o on o.id = oi.order_id
     where e.id = ${enrollmentId}`;

  if (!row) return null;

  const proRata =
    row.sessions_total > 0
      ? Math.ceil((row.paid_cents * row.sessions_remaining) / row.sessions_total)
      : row.paid_cents;

  return {
    enrollmentId: row.enrollment_id,
    child: row.child,
    title: row.title,
    paidCents: row.paid_cents,
    sessionsTotal: row.sessions_total,
    sessionsRemaining: row.sessions_remaining,
    fullCents: row.paid_cents,
    proRataCents: Math.min(proRata, row.paid_cents),
    paymentIntentId: row.payment_intent_id,
  };
}

export type RefundOutcome =
  | { ok: true; refundId: string; status: string; amountCents: number }
  | { ok: false; error: string };

/**
 * Send the refund to Stripe and record what came back.
 *
 * The idempotency key is the enrollment id, so a double-clicked approval or a
 * retried action returns Stripe's original refund rather than issuing a second
 * one. That is the difference between a retry and paying a family twice.
 */
export async function issueRefund(
  enrollmentId: string,
  amountCents: number,
  by: string,
): Promise<RefundOutcome> {
  const quote = await quoteRefund(enrollmentId);
  if (!quote) return { ok: false, error: "That registration no longer exists." };

  if (amountCents <= 0 || amountCents > quote.paidCents) {
    return { ok: false, error: "Refund amount is outside what was paid." };
  }

  if (!quote.paymentIntentId) {
    return {
      ok: false,
      error: "No Stripe payment is recorded against this registration, so nothing can be refunded automatically.",
    };
  }

  await sql`update enrollments
               set refund_amount_cents = ${amountCents},
                   refund_requested_at = now(),
                   refund_error = null
             where id = ${enrollmentId}`;

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: quote.paymentIntentId,
        amount: amountCents,
        metadata: { enrollment_id: enrollmentId, approved_by: by },
      },
      { idempotencyKey: `refund:${enrollmentId}` },
    );

    const succeeded = refund.status === "succeeded";

    await sql`update enrollments
                 set stripe_refund_id = ${refund.id},
                     refund_status = ${refund.status ?? "pending"},
                     refund_amount_cents = ${refund.amount},
                     refund_owed = ${!succeeded},
                     refunded_at = ${succeeded ? sql`now()` : null}
               where id = ${enrollmentId}`;

    await sql`insert into enrollment_events (enrollment_id, event, payload)
              values (${enrollmentId}, 'refund_issued',
                      ${JSON.stringify({
                        by,
                        stripe_refund_id: refund.id,
                        amount_cents: refund.amount,
                        status: refund.status,
                      })}::jsonb)`;

    return { ok: true, refundId: refund.id, status: refund.status ?? "pending", amountCents: refund.amount };
  } catch (e) {
    const message = (e as Error).message;

    // The refund did not go out. Leave refund_owed set so it stays on the
    // list, and keep the reason so nobody has to guess at it later.
    await sql`update enrollments
                 set refund_status = 'failed', refund_error = ${message}, refund_owed = true
               where id = ${enrollmentId}`;

    await sql`insert into enrollment_events (enrollment_id, event, payload)
              values (${enrollmentId}, 'refund_failed',
                      ${JSON.stringify({ by, error: message })}::jsonb)`;

    return { ok: false, error: message };
  }
}

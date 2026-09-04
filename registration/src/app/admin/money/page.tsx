import { formatMoney } from "@/lib/stripe";
import {
  readAsStaff,
  unconfirmedOrders,
  cancellationRequests,
  refundRows,
  paymentRows,
} from "../queries";
import { EmptyState, PageHead, Pill, Stat, refundTone, when, ago } from "../ui";
import { declineCancellation, markRefunded, retryRefund } from "../actions";
import { ApproveWithRefund } from "../approve-with-refund";
import { MoneyTabs } from "./tabs";
import { PaymentRowDetail } from "./payment-row";

export const dynamic = "force-dynamic";

/**
 * Money, in one place.
 *
 * Payments, cancellations and refunds were three separate rail entries, which
 * made them look like three unrelated jobs. They are one job: the state of the
 * money. A cancellation becomes a refund becomes a line in the ledger, and
 * following that thread used to mean three pages and remembering where you
 * started.
 *
 * Sub tabs rather than separate routes, so the totals above stay visible while
 * you move between them and the URL is still shareable.
 */
export default async function Money({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = ["unconfirmed", "cancellations", "refunds", "ledger"].includes(tab ?? "")
    ? tab!
    : "unconfirmed";

  const { data } = await readAsStaff(async (tx) => ({
    unconfirmed: await unconfirmedOrders(tx),
    cancellations: await cancellationRequests(tx),
    refunds: await refundRows(tx),
    ledger: await paymentRows(tx, {}),
  }));

  const owed = data.refunds.filter((r) => r.refund_owed);
  const failed = owed.filter((r) => r.refund_status === "failed");

  const paidOrders = data.ledger.filter((p) => p.status === "paid");
  const collected = paidOrders.reduce((s, p) => s + p.amount_cents, 0);
  const refunded = data.ledger.reduce((s, p) => s + p.refunded_cents, 0);

  return (
    <div className="space-y-4">
      <PageHead
        title="Money"
        note="What has been taken, what is owed back, and what is still unresolved. One thread, because a cancellation becomes a refund becomes a line in the ledger."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon="cash"
          tint="good"
          label="Collected"
          value={formatMoney(collected)}
          note={`${paidOrders.length} paid order${paidOrders.length === 1 ? "" : "s"}`}
        />
        <Stat
          icon="undo"
          tint={refunded > 0 ? "warn" : "good"}
          label="Refunded"
          value={formatMoney(refunded)}
          note="everything returned so far"
        />
        <Stat
          icon="card"
          tint={data.unconfirmed.length > 0 ? "danger" : "good"}
          label="Unconfirmed"
          value={String(data.unconfirmed.length)}
          note={
            data.unconfirmed.length > 0
              ? "money moved, fulfilment did not"
              : "every payment reconciled"
          }
        />
        <Stat
          icon="warning"
          tint={failed.length > 0 ? "danger" : owed.length > 0 ? "warn" : "good"}
          label="Owed back"
          value={formatMoney(
            owed.reduce((s, r) => s + (r.refund_amount_cents ?? r.paid_cents), 0),
          )}
          note={failed.length > 0 ? `${failed.length} failed at Stripe` : `${owed.length} in flight`}
        />
      </div>

      <MoneyTabs
        active={active}
        counts={{
          unconfirmed: data.unconfirmed.length,
          cancellations: data.cancellations.length,
          refunds: owed.length,
          ledger: data.ledger.length,
        }}
      />

      {active === "unconfirmed" && (
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Paid, not confirmed</h2>
              <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
                Stripe retries a failed webhook for three days on its own, so this list
                normally empties itself. The seats are already held, so nothing is lost
                while it resolves.
              </p>
            </div>
          </div>
          {data.unconfirmed.length === 0 ? (
            <EmptyState
              icon="check"
              title="Every payment is confirmed"
              note="No order has taken money without completing fulfilment."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Family</th>
                    <th>Payment intent</th>
                    <th className="ops-num">Children</th>
                    <th className="ops-num">Amount</th>
                    <th>Taken</th>
                    <th className="ops-num">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unconfirmed.map((o) => (
                    <tr key={o.order_id}>
                      <td>
                        <p className="font-medium">{o.parent}</p>
                        <p className="ops-mono">{o.email}</p>
                      </td>
                      <td>
                        {o.payment_intent ? (
                          <a
                            className="ops-mono underline decoration-dotted underline-offset-2"
                            href={`https://dashboard.stripe.com/test/payments/${o.payment_intent}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {o.payment_intent}
                          </a>
                        ) : (
                          <span className="ops-mono">none recorded</span>
                        )}
                      </td>
                      <td className="ops-num">{o.children}</td>
                      <td className="ops-num font-medium">{formatMoney(o.amount_cents)}</td>
                      <td className="text-[var(--ops-muted)]">{when(new Date(o.created_at))}</td>
                      <td className="ops-num">
                        <Pill tone={o.minutes_waiting > 5 ? "danger" : "warn"}>
                          {ago(o.minutes_waiting)}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {active === "cancellations" && (
        <div className="space-y-3">
          {data.cancellations.length === 0 ? (
            <section className="ops-panel ops-enter">
              <EmptyState
                icon="check"
                title="No open requests"
                note="Nothing is waiting on a decision from the office."
              />
            </section>
          ) : (
            data.cancellations.map((r) => (
              <section key={r.enrollment_id} className="ops-panel ops-enter p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.child}
                      <span className="font-normal text-[var(--ops-muted)]"> in {r.title}</span>
                    </p>
                    <p className="ops-mono truncate">
                      {r.parent} · {r.email} · {r.school}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="quiet">
                      {r.sessions_remaining} of {r.sessions_total} left
                    </Pill>
                    <Pill tone="warn">asked {when(new Date(r.requested_at))}</Pill>
                    <span className="font-semibold">{formatMoney(r.paid_cents)} paid</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-[var(--ops-line-soft)] pt-3">
                  <ApproveWithRefund
                    enrollmentId={r.enrollment_id}
                    paidCents={r.paid_cents}
                    sessionsTotal={r.sessions_total}
                    sessionsRemaining={r.sessions_remaining}
                    hasPayment={r.has_payment}
                  />
                  <form action={declineCancellation}>
                    <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                    <button className="ops-btn">Decline, keep the place</button>
                  </form>
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {active === "refunds" && (
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Refunds</h2>
              <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
                Issued through the Stripe API the moment a cancellation is approved.
                Retrying reuses the same idempotency key, so a family is never paid twice.
              </p>
            </div>
          </div>
          {data.refunds.length === 0 ? (
            <EmptyState
              icon="check"
              title="Nothing to refund"
              note="No cancelled registration is owed money."
            />
          ) : (
            <div>
              {data.refunds.map((r) => {
                const amount = r.refund_amount_cents ?? r.paid_cents;
                return (
                  <div
                    key={r.enrollment_id}
                    className="border-b border-[var(--ops-line-soft)] p-4 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.child}
                          <span className="font-normal text-[var(--ops-muted)]">
                            {" "}
                            in {r.title}
                          </span>
                        </p>
                        <p className="ops-mono truncate">
                          {r.parent} · {r.email}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[17px] font-semibold">{formatMoney(amount)}</p>
                        <p className="ops-mono">
                          {amount < r.paid_cents ? "partial of " : "full, "}
                          {formatMoney(r.paid_cents)} paid
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Pill tone={refundTone(r.refund_status)}>
                        {r.refund_status ?? "not started"}
                      </Pill>
                      {r.stripe_refund_id && (
                        <a
                          className="ops-mono underline decoration-dotted underline-offset-2"
                          href={`https://dashboard.stripe.com/test/refunds/${r.stripe_refund_id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.stripe_refund_id}
                        </a>
                      )}
                      {r.refunded_at && (
                        <span className="ops-mono">confirmed {when(new Date(r.refunded_at))}</span>
                      )}
                    </div>

                    {r.refund_error && (
                      <p className="mt-2.5 rounded-md bg-[var(--ops-danger-soft)] px-3 py-2 text-[var(--ops-danger)]">
                        Stripe refused it: {r.refund_error}
                      </p>
                    )}

                    {r.refund_owed && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <form action={retryRefund}>
                          <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                          <input type="hidden" name="refundCents" value={amount} />
                          <button className="ops-btn ops-btn-primary">
                            {r.stripe_refund_id ? "Send again" : "Send refund now"}
                          </button>
                        </form>
                        <form action={markRefunded}>
                          <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                          <button className="ops-btn">Settled outside Stripe</button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {active === "ledger" && (
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Every order</h2>
              <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
                Open a row for the detail. Nothing is ever deleted, so a cancelled place
                still has its payment history attached.
              </p>
            </div>
          </div>
          {data.ledger.length === 0 ? (
            <EmptyState icon="cash" title="No orders yet" note="Registrations will appear here." />
          ) : (
            <table className="ops-table">
              <tbody>
                {data.ledger.map((p) => (
                  <PaymentRowDetail key={p.order_id} payment={p} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

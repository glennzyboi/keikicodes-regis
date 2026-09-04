import { formatMoney } from "@/lib/stripe";
import { readAsStaff, unconfirmedOrders } from "../queries";
import { EmptyState, PageHead, Pill, ago, when } from "../ui";

export const dynamic = "force-dynamic";

export default async function Payments() {
  const { data: orders } = await readAsStaff((tx) => unconfirmedOrders(tx));

  return (
    <div className="space-y-4">
      <PageHead
        title="Payments"
        note="Orders where money has moved but fulfilment has not finished. Stripe retries a failed webhook for three days on its own, so this list normally empties itself. Anything sitting here for more than a few minutes is worth opening in Stripe."
      />

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Paid, not confirmed
              {orders.length > 0 && (
                <span className="ops-pill ops-pill-danger ml-2 align-middle">{orders.length}</span>
              )}
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              The seats are already held, so nothing is lost while this resolves.
            </p>
          </div>
        </div>

        {orders.length === 0 ? (
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
                {orders.map((o) => (
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
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/money";
import { isUuid } from "@keiki/core/uuid";
import { readAsStaff, paymentRows, countOf } from "@/app/admin/queries";
import { EmptyState, Pager, Pill, PER_PAGE, pageFrom, when } from "@/app/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Every order that bought a place in this class.
 *
 * Paginated like the main ledger rather than dumped in full: a popular class
 * across three terms is a long list, and this used to render all of it under
 * the roster and the calendar where nobody scrolled far enough to notice.
 */
export default async function ClassMoney({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const page = pageFrom((await searchParams).page);

  const { data } = await readAsStaff(async (tx) => ({
    payments: await paymentRows(tx, { classOfferingId: id, page, perPage: PER_PAGE }),
    total: await countOf(tx, "ledger", { classOfferingId: id }),
  }));

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">
            Orders
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
          </h2>
          <p className="mt-0.5 text-[var(--ops-muted)]">
            Nothing is ever deleted, so a cancelled place still has its payment history
            attached here.
          </p>
        </div>
      </div>

      {data.payments.length === 0 ? (
        <EmptyState
          icon="cash"
          title="No orders yet"
          note="Payments for this class will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Family</th>
                <th className="ops-num">Amount</th>
                <th className="ops-num">Refunded</th>
                <th>Status</th>
                <th>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.order_id}>
                  <td className="text-[var(--ops-muted)]">{when(new Date(p.created_at))}</td>
                  <td>
                    <Link
                      href={`/admin/families/${p.parent_id}`}
                      className="underline decoration-dotted underline-offset-2"
                    >
                      {p.parent_name}
                    </Link>
                    <p className="ops-mono">{p.email}</p>
                  </td>
                  <td className="ops-num font-medium">{formatMoney(p.amount_cents)}</td>
                  <td className="ops-num">
                    {p.refunded_cents > 0 ? formatMoney(p.refunded_cents) : "—"}
                  </td>
                  <td>
                    <Pill tone={p.status === "paid" ? "good" : "warn"}>{p.status}</Pill>
                  </td>
                  <td>
                    {p.payment_intent ? (
                      <a
                        className="ops-mono underline decoration-dotted underline-offset-2"
                        href={`https://dashboard.stripe.com/test/payments/${p.payment_intent}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open
                      </a>
                    ) : (
                      <span className="ops-mono">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} total={data.total} basePath={`/admin/classes/${id}/money`} />
    </section>
  );
}

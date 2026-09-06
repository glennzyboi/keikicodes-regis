import { Suspense } from "react";
import { formatMoney } from "@keiki/core/stripe";
import { PARENT_CANCEL_REASONS } from "@keiki/core/schedule-reasons";
import {
  readAsStaff,
  unconfirmedOrders,
  cancellationRequests,
  refundRows,
  paymentRows,
  moneyTotals,
  countOf,
  type CancellationFilters,
  type LedgerFilters,
  type RefundFilters,
} from "@/app/admin/queries";
import { classFilterOptions } from "@/app/admin/class-queries";
import { FilterBar, type FilterSelect } from "@/app/admin/filters";
import {
  EmptyState,
  PageHead,
  Pager,
  Pill,
  Stat,
  TableSkeleton,
  PER_PAGE,
  pageFrom,
  refundTone,
  when,
  ago,
} from "@/app/admin/ui";
import { declineCancellation, markRefunded, retryRefund, convertToDrop } from "@/app/admin/actions";
import { ApproveWithRefund } from "@/app/admin/approve-with-refund";
import { MoneyTabs } from "./tabs";
import { PaymentRowDetail } from "./payment-row";

export const dynamic = "force-dynamic";

const TABS = ["unconfirmed", "cancellations", "refunds", "ledger"] as const;
type Tab = (typeof TABS)[number];

const ORDER_STATUS = [
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

const REFUND_STATES = [
  { value: "owed", label: "Still owed" },
  { value: "failed", label: "Failed at Stripe" },
  { value: "done", label: "Sent" },
];

/**
 * Money, in one place.
 *
 * Payments, cancellations and refunds were three separate rail entries, which
 * made them look like three unrelated jobs. They are one job, the state of the
 * money: a cancellation becomes a refund becomes a line in the ledger, and
 * following that thread used to mean three pages and remembering where you
 * started.
 *
 * All four tabs page now. Three of them were unbounded reads that happened to
 * be short today, which is the kind of thing that is fine for a term and then
 * quietly is not.
 */
export default async function Money({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);
  const active: Tab = (TABS as readonly string[]).includes(params.tab ?? "")
    ? (params.tab as Tab)
    : "unconfirmed";

  const { data: head } = await readAsStaff(async (tx) => ({
    // Over every order, not over the page being rendered. Summing the rendered
    // array is what made "Collected" wrong past the two hundredth order.
    totals: await moneyTotals(tx),
    counts: {
      unconfirmed: await countOf(tx, "unconfirmed"),
      cancellations: await countOf(tx, "cancellations"),
      refunds: await countOf(tx, "refunds"),
      ledger: await countOf(tx, "ledger"),
    },
    options: await classFilterOptions(tx),
  }));

  const schools = head.options.schools;
  const school = schools.some((s) => s.id === params.school) ? params.school : undefined;

  const campusSelect: FilterSelect = {
    name: "school",
    label: "Campus",
    value: school,
    anyLabel: "All campuses",
    options: schools.map((s) => ({ value: s.id, label: s.name })),
  };

  const selects: FilterSelect[] =
    active === "ledger"
      ? [
          {
            name: "status",
            label: "Status",
            value: ORDER_STATUS.some((s) => s.value === params.status) ? params.status : undefined,
            anyLabel: "Any status",
            options: ORDER_STATUS,
          },
          campusSelect,
        ]
      : active === "cancellations"
        ? [
            {
              name: "reason",
              label: "Reason",
              value: PARENT_CANCEL_REASONS.some((r) => r.code === params.reason)
                ? params.reason
                : undefined,
              anyLabel: "Any reason",
              options: PARENT_CANCEL_REASONS.map((r) => ({ value: r.code, label: r.label })),
            },
            campusSelect,
          ]
        : active === "refunds"
          ? [
              {
                name: "state",
                label: "State",
                value: REFUND_STATES.some((s) => s.value === params.state)
                  ? params.state
                  : undefined,
                anyLabel: "Any state",
                options: REFUND_STATES,
              },
            ]
          : [];

  const linkParams = {
    tab: active,
    q: params.q,
    status: params.status,
    school,
    reason: params.reason,
    state: params.state,
  };

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
          value={formatMoney(head.totals.collected_cents)}
          note={`${head.totals.paid_orders} paid order${head.totals.paid_orders === 1 ? "" : "s"}`}
        />
        <Stat
          icon="undo"
          tint={head.totals.refunded_cents > 0 ? "warn" : "good"}
          label="Refunded"
          value={formatMoney(head.totals.refunded_cents)}
          note="everything returned so far"
        />
        <Stat
          icon="card"
          tint={head.counts.unconfirmed > 0 ? "danger" : "good"}
          label="Unconfirmed"
          value={String(head.counts.unconfirmed)}
          note={
            head.counts.unconfirmed > 0
              ? "money moved, fulfilment did not"
              : "every payment reconciled"
          }
        />
        <Stat
          icon="warning"
          tint={head.counts.cancellations > 0 ? "warn" : "good"}
          label="Waiting on a decision"
          value={String(head.counts.cancellations)}
          note="cancellations asked for by families"
        />
      </div>

      <MoneyTabs active={active} counts={head.counts} />

      {selects.length > 0 && (
        <FilterBar
          basePath="/admin/money"
          search={
            active === "ledger"
              ? { value: params.q, placeholder: "Family or email" }
              : undefined
          }
          selects={selects.map((s) => ({ ...s }))}
        />
      )}

      <Suspense
        key={`${active}|${JSON.stringify(linkParams)}|${page}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={6} />
          </div>
        }
      >
        <TabBody tab={active} page={page} params={params} school={school} linkParams={linkParams} />
      </Suspense>
    </div>
  );
}

async function TabBody({
  tab,
  page,
  params,
  school,
  linkParams,
}: {
  tab: Tab;
  page: number;
  params: Record<string, string | undefined>;
  school: string | undefined;
  linkParams: Record<string, string | undefined>;
}) {
  if (tab === "unconfirmed") return <Unconfirmed page={page} linkParams={linkParams} />;
  if (tab === "cancellations") {
    const f: CancellationFilters = {
      reason: PARENT_CANCEL_REASONS.some((r) => r.code === params.reason)
        ? params.reason
        : undefined,
      school,
    };
    return <Cancellations filters={f} page={page} linkParams={linkParams} />;
  }
  if (tab === "refunds") {
    const f: RefundFilters = {
      state: REFUND_STATES.some((s) => s.value === params.state) ? params.state : undefined,
    };
    return <Refunds filters={f} page={page} linkParams={linkParams} />;
  }
  const f: LedgerFilters = {
    status: ORDER_STATUS.some((s) => s.value === params.status) ? params.status : undefined,
    school,
    search: params.q?.trim() || undefined,
  };
  return <Ledger filters={f} page={page} linkParams={linkParams} />;
}

async function Unconfirmed({
  page,
  linkParams,
}: {
  page: number;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await unconfirmedOrders(tx, { page, perPage: PER_PAGE }),
    total: await countOf(tx, "unconfirmed"),
  }));

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">Paid, not confirmed</h2>
          <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
            Stripe retries a failed webhook for three days on its own, so this list
            normally empties itself. The seats are already held, so nothing is lost while
            it resolves.
          </p>
        </div>
      </div>
      {data.rows.length === 0 ? (
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
              {data.rows.map((o) => (
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
      <Pager page={page} total={data.total} basePath="/admin/money" params={linkParams} />
    </section>
  );
}

async function Cancellations({
  filters,
  page,
  linkParams,
}: {
  filters: CancellationFilters;
  page: number;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await cancellationRequests(tx, { ...filters, page, perPage: PER_PAGE }),
    // Unfiltered, because the pager for a filtered list needs a filtered total.
    total: (await cancellationRequests(tx, filters)).length,
  }));

  return (
    <div className="space-y-3">
      {data.rows.length === 0 ? (
        <section className="ops-panel ops-enter">
          <EmptyState
            icon="check"
            title="No open requests"
            note="Nothing is waiting on a decision from the office."
          />
        </section>
      ) : (
        data.rows.map((r) => (
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
            {/* Why they are leaving. It used to say "requested by parent", which
                is not a reason, so the office approved refunds all term without
                ever learning that most of them were the time clashing. */}
            {(r.cancellation_reason || r.cancellation_note) && (
              <div className="mt-3 rounded-lg bg-[var(--ops-tint)] px-3 py-2">
                {r.cancellation_reason && <p className="font-medium">{r.cancellation_reason}</p>}
                {r.cancellation_note && (
                  <p className="mt-0.5 text-[var(--ops-muted)]">
                    &ldquo;{r.cancellation_note}&rdquo;
                  </p>
                )}
              </div>
            )}

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
              <form action={convertToDrop}>
                <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                <button className="ops-btn ops-btn-danger">Drop instead (no refund)</button>
              </form>
            </div>
          </section>
        ))
      )}

      <div className="ops-panel ops-enter">
        <Pager page={page} total={data.total} basePath="/admin/money" params={linkParams} />
      </div>
    </div>
  );
}

async function Refunds({
  filters,
  page,
  linkParams,
}: {
  filters: RefundFilters;
  page: number;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await refundRows(tx, { ...filters, page, perPage: PER_PAGE }),
    total: (await refundRows(tx, filters)).length,
  }));

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">Refunds</h2>
          <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
            Issued through the Stripe API the moment a cancellation is approved. Retrying
            reuses the same idempotency key, so a family is never paid twice.
          </p>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing to refund"
          note="No cancelled registration is owed money."
        />
      ) : (
        <div>
          {data.rows.map((r) => {
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
                      <span className="font-normal text-[var(--ops-muted)]"> in {r.title}</span>
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
      <Pager page={page} total={data.total} basePath="/admin/money" params={linkParams} />
    </section>
  );
}

async function Ledger({
  filters,
  page,
  linkParams,
}: {
  filters: LedgerFilters;
  page: number;
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await paymentRows(tx, { ...filters, page, perPage: PER_PAGE }),
    total: await countOf(tx, "ledger", filters),
  }));

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <div>
          <h2 className="text-[15px] font-semibold">
            Every order
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
          </h2>
          <p className="mt-0.5 max-w-2xl text-[var(--ops-muted)]">
            Open a row for the detail. Nothing is ever deleted, so a cancelled place still
            has its payment history attached.
          </p>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon="cash" title="No orders match" note="Take a filter off." />
      ) : (
        <table className="ops-table">
          <tbody>
            {data.rows.map((p) => (
              <PaymentRowDetail key={p.order_id} payment={p} />
            ))}
          </tbody>
        </table>
      )}

      {/* These rows expand in place to show the detail, so they are already
          interactive and are deliberately not turned into row links: a click
          cannot mean both "open this" and "go elsewhere". */}
      <Pager page={page} total={data.total} basePath="/admin/money" params={linkParams} />
    </section>
  );
}


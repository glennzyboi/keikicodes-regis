import Link from "next/link";
import { formatMoney } from "@keiki/core/stripe";
import {
  readAsStaff,
  unconfirmedOrders,
  cancellationRequests,
  refundRows,
  classRows,
  activity,
  dailyRegistrations,
  holdRows,
  capacityTotals,
} from "@/app/admin/queries";
import {
  Stat,
  Icon,
  Pill,
  EmptyState,
  Pager,
  RowLink,
  PER_PAGE,
  initials,
  pageFrom,
  tintFor,
  ago,
} from "@/app/admin/ui";
import { RegistrationsChart } from "@/app/admin/registrations-chart";

export const dynamic = "force-dynamic";

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = pageFrom((await searchParams).page);

  const { staff, data } = await readAsStaff(async (tx) => ({
    unconfirmed: await unconfirmedOrders(tx),
    cancellations: await cancellationRequests(tx),
    refunds: await refundRows(tx),
    // Ten at a time, drift first. Unbounded, this rendered one full height row
    // per published class on the landing page, and it grows with the catalogue.
    classes: await classRows(tx, { page, perPage: PER_PAGE, driftFirst: true }),
    // The totals come from SQL over every class, not from the page above. They
    // used to be a reduce over the rendered array, which paginating would have
    // quietly turned into "the enrolment across these ten classes".
    totals: await capacityTotals(tx),
    holds: await holdRows(tx),
    feed: await activity(tx, 10),
    days: await dailyRegistrations(tx, 14),
  }));

  const owed = data.refunds.filter((r) => r.refund_owed);
  const failed = owed.filter((r) => r.refund_status === "failed");

  const { enrolled, capacity, revenue_cents: revenue } = data.totals;

  // Two seven day windows, so the delta compares like with like.
  const recent = data.days.slice(-7);
  const prior = data.days.slice(0, 7);
  const recentCount = recent.reduce((s, d) => s + d.registrations, 0);
  const priorCount = prior.reduce((s, d) => s + d.registrations, 0);
  const pct =
    priorCount === 0
      ? recentCount > 0
        ? 100
        : 0
      : Math.round(((recentCount - priorCount) / priorCount) * 100);

  const open = data.unconfirmed.length + data.cancellations.length + owed.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ops-label">Overview</p>
          <h1 className="mt-1 text-[21px] font-semibold">
            {open === 0 ? "Nothing needs a decision" : `${open} waiting on you`}
          </h1>
          <p className="mt-1 text-[var(--ops-muted)]">
            {new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              timeZone: "Pacific/Honolulu",
            }).format(new Date())}{" "}
            in Honolulu. Signed in as {staff.fullName}.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon="users"
          tint="accent"
          label="Registrations, 7 days"
          value={String(recentCount)}
          delta={{ pct, label: `${pct > 0 ? "+" : ""}${pct}%` }}
          note={`${priorCount} the week before`}
          spark={recent.map((d) => d.registrations)}
        />
        <Stat
          icon="card"
          tint={data.unconfirmed.length > 0 ? "danger" : "good"}
          label="Unconfirmed payments"
          value={String(data.unconfirmed.length)}
          note={
            data.unconfirmed.length > 0
              ? "money moved, fulfilment did not"
              : "every payment reconciled"
          }
        />
        <Stat
          icon="cash"
          tint={failed.length > 0 ? "danger" : owed.length > 0 ? "warn" : "good"}
          label="Refunds outstanding"
          value={formatMoney(owed.reduce((s, r) => s + (r.refund_amount_cents ?? r.paid_cents), 0))}
          note={failed.length > 0 ? `${failed.length} failed at Stripe` : `${owed.length} in flight`}
        />
        <Stat
          icon="book"
          tint="violet"
          label="Booked revenue"
          value={formatMoney(revenue)}
          note={`${enrolled} of ${capacity} seats filled`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Registrations</h2>
              <p className="mt-0.5 text-[var(--ops-muted)]">
                Last fourteen days, by Honolulu date
              </p>
            </div>
            <div className="text-right">
              <p className="text-[19px] font-semibold">{recentCount + priorCount}</p>
              <p className="ops-mono">in the period</p>
            </div>
          </div>
          <div className="p-4">
            <RegistrationsChart points={data.days} />
          </div>
        </section>

        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <div>
              <h2 className="text-[15px] font-semibold">Activity</h2>
              <p className="mt-0.5 text-[var(--ops-muted)]">
                Every decision writes one of these
              </p>
            </div>
          </div>

          {data.feed.length === 0 ? (
            <EmptyState icon="check" title="Nothing yet" note="Actions will appear here." />
          ) : (
            <div>
              {data.feed.map((row) => {
                const who = (row.payload?.by as string) ?? null;
                const seed = row.parent ?? who ?? row.event;
                return (
                  <div key={row.id} className="ops-feed-item">
                    <span
                      className="ops-avatar"
                      style={{ background: tintFor(seed), width: 26, height: 26, fontSize: 10 }}
                    >
                      {initials(row.parent ?? who ?? "System")}
                    </span>
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{row.child ?? "An order"}</span>{" "}
                        <span className="text-[var(--ops-muted)]">
                          {describe(row.event, row.payload)}
                        </span>
                      </p>
                      <p className="ops-mono">
                        {ago(row.minutes_ago)}
                        {who ? ` · ${who}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Anchored, so paging this section returns you to it rather than to the
          top of a long dashboard. */}
      <section className="ops-panel ops-enter" id="capacity">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Capacity
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">
                {data.totals.classes}
              </span>
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Enrolled plus held must equal seats taken. Anything else is drift.
              {data.totals.drifting > 0
                ? ` ${data.totals.drifting} ${data.totals.drifting === 1 ? "class does" : "classes do"} not reconcile, and they are first.`
                : " Everything reconciles."}
            </p>
          </div>
          <Link href="/admin/classes" className="ops-btn">
            All classes
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Campus</th>
                <th className="ops-num">Enrolled</th>
                <th className="ops-num">Held</th>
                <th className="ops-num">Seats</th>
                <th style={{ width: 130 }}>Fill</th>
                <th className="ops-num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.classes.map((c) => {
                const reconciles = c.enrolled + c.held === c.seats_taken;
                const pctFull = Math.round((c.seats_taken / c.capacity) * 100);
                return (
                  <tr key={c.id}>
                    <td>
                      <RowLink
                        href={`/admin/classes/${c.id}`}
                        label={`${c.title} at ${c.school}`}
                      >
                        <span className="font-medium">{c.title}</span>
                      </RowLink>
                      {!reconciles && (
                        <span className="ml-2">
                          <Pill tone="danger">
                            <Icon name="warning" size={11} />
                            drift
                          </Pill>
                        </span>
                      )}
                    </td>
                    <td className="text-[var(--ops-muted)]">{c.school}</td>
                    <td className="ops-num">{c.enrolled}</td>
                    <td className="ops-num">{c.held}</td>
                    <td className="ops-num">
                      {c.seats_taken}
                      <span className="text-[var(--ops-faint)]">/{c.capacity}</span>
                    </td>
                    <td>
                      <div
                        className="ops-meter"
                        data-tone={pctFull >= 100 ? "full" : undefined}
                        role="img"
                        aria-label={`${pctFull}% full`}
                      >
                        <span style={{ width: `${Math.min(pctFull, 100)}%` }} />
                      </div>
                    </td>
                    <td className="ops-num font-medium">{formatMoney(c.revenue_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pager
          page={page}
          total={data.totals.classes}
          basePath="/admin"
          anchor="capacity"
        />
      </section>
    </div>
  );
}

/** Turn an audit row into something readable at a glance. */
function describe(event: string, payload: Record<string, unknown> | null) {
  const cents = payload?.amount_cents as number | undefined;
  const money = cents !== undefined ? ` ${formatMoney(cents)}` : "";

  switch (event) {
    case "order_created":
      return "started a registration";
    case "enrolled":
      return "was enrolled after payment";
    case "enrolled_over_capacity":
      return "was enrolled over capacity and needs a look";
    case "cancellation_requested":
      return "cancellation requested by the parent";
    case "cancellation_approved":
      return "cancellation approved, seat freed";
    case "cancellation_declined":
      return "cancellation declined, place kept";
    case "refund_issued":
      return `refund${money} sent to Stripe`;
    case "refund_succeeded":
      return `refund${money} confirmed by Stripe`;
    case "refund_failed":
      return "refund failed at Stripe";
    case "refund_marked_paid":
      return "refund settled outside Stripe";
    default:
      return event.replace(/_/g, " ");
  }
}

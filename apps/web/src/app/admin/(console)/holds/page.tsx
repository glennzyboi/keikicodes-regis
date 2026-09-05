import { Suspense } from "react";
import {
  readAsStaff,
  holdRows,
  holdCount,
  type HoldFilters,
} from "@/app/admin/queries";
import { classFilterOptions } from "@/app/admin/class-queries";
import { FilterBar } from "@/app/admin/filters";
import {
  EmptyState,
  PageHead,
  Pager,
  Pill,
  RowLink,
  TableSkeleton,
  PER_PAGE,
  pageFrom,
} from "@/app/admin/ui";

export const dynamic = "force-dynamic";

const STATES = [
  { value: "live", label: "Still counting down" },
  { value: "expired", label: "Expired, awaiting sweep" },
  { value: "protected", label: "Protected (paid)" },
];

/**
 * Seat holds.
 *
 * In the System group now, because that is what this is: a window onto the
 * machinery, not a queue anybody works. Every row here resolves itself. The
 * sweeper returns expired holds and never one whose order is paid, and the hold
 * and the Stripe session expire together so a parent taking their time cannot
 * lose the seat while still holding a live payment page.
 *
 * It is worth having a page at all for exactly one reason: when somebody rings
 * to say "it said the class was full but I was halfway through paying", this is
 * the screen that answers them.
 */
export default async function Holds({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);

  const { data: options } = await readAsStaff((tx) => classFilterOptions(tx));

  const filters: HoldFilters = {
    school: options.schools.some((s) => s.id === params.school) ? params.school : undefined,
    state: STATES.some((s) => s.value === params.state) ? params.state : undefined,
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Seat holds"
        note="Seats taken before payment, held while a parent is on Stripe's page. The hold and the Stripe session expire together, so a parent who takes their time cannot lose the seat while still holding a live payment page."
      />

      <FilterBar
        basePath="/admin/holds"
        selects={[
          {
            name: "state",
            label: "State",
            value: filters.state,
            anyLabel: "Any state",
            options: STATES,
          },
          {
            name: "school",
            label: "Campus",
            value: filters.school,
            anyLabel: "All campuses",
            options: options.schools.map((s) => ({ value: s.id, label: s.name })),
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={6} />
          </div>
        }
      >
        <Rows filters={filters} page={page} />
      </Suspense>
    </div>
  );
}

async function Rows({ filters, page }: { filters: HoldFilters; page: number }) {
  const { data } = await readAsStaff(async (tx) => ({
    holds: await holdRows(tx, { ...filters, page, perPage: PER_PAGE }),
    total: await holdCount(tx, filters),
    protectedCount: await holdCount(tx, { ...filters, state: "protected" }),
    expired: await holdCount(tx, { ...filters, state: "expired" }),
  }));

  return (
    <div className="space-y-4">
      {data.protectedCount > 0 && (
        <div className="ops-panel ops-enter p-4">
          <p className="font-medium">
            {data.protectedCount} hold{data.protectedCount === 1 ? "" : "s"} belong to a paid
            order
          </p>
          <p className="mt-1 text-[var(--ops-muted)]">
            These are protected. The sweeper will not release them however long they sit
            here, because taking a seat back from a family who has paid is the one failure
            that costs a place on the first day of term.
          </p>
        </div>
      )}

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              In progress
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              {data.expired > 0
                ? `${data.expired} expired, returning to the pool on the next sweep`
                : "None expired"}
            </p>
          </div>
        </div>

        {data.holds.length === 0 ? (
          <EmptyState
            icon="check"
            title="No checkouts in progress"
            note="Every seat is either enrolled or free."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Child</th>
                  <th>Class</th>
                  <th>Campus</th>
                  <th>Family</th>
                  <th>Order</th>
                  <th className="ops-num">Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.holds.map((h) => (
                  <tr key={h.hold_id}>
                    <td className="font-medium">
                      <RowLink
                        href={`/admin/classes/${h.class_offering_id}`}
                        label={`${h.child} holding a seat in ${h.title}`}
                      >
                        {h.child}
                      </RowLink>
                    </td>
                    <td>{h.title}</td>
                    <td className="text-[var(--ops-muted)]">{h.school}</td>
                    <td className="text-[var(--ops-muted)]">{h.parent}</td>
                    <td>
                      <Pill tone={h.order_status === "paid" ? "good" : "quiet"}>
                        {h.order_status}
                      </Pill>
                    </td>
                    <td className="ops-num">
                      {h.order_status === "paid" ? (
                        <Pill tone="good">protected</Pill>
                      ) : h.minutes_left > 0 ? (
                        <span className="text-[var(--ops-muted)]">{h.minutes_left}m left</span>
                      ) : (
                        <Pill tone="warn">expired</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          page={page}
          total={data.total}
          basePath="/admin/holds"
          params={{ school: filters.school, state: filters.state }}
        />
      </section>
    </div>
  );
}

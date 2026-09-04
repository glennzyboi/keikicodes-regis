import { readAsStaff, holdRows } from "../queries";
import { EmptyState, PageHead, Pill } from "../ui";

export const dynamic = "force-dynamic";

export default async function Holds() {
  const { data: holds } = await readAsStaff((tx) => holdRows(tx));

  const expired = holds.filter((h) => h.minutes_left <= 0);
  const paid = holds.filter((h) => h.order_status === "paid");

  return (
    <div className="space-y-4">
      <PageHead
        title="Seat holds"
        note="Seats taken before payment, held while a parent is on Stripe's page. The hold and the Stripe session expire together, so a parent who takes their time cannot lose the seat while still holding a live payment page. The sweeper returns expired holds, and never one whose order is paid."
      />

      {paid.length > 0 && (
        <div className="ops-panel ops-enter p-4">
          <p className="font-medium">
            {paid.length} hold{paid.length === 1 ? "" : "s"} belong to a paid order
          </p>
          <p className="mt-1 text-[var(--ops-muted)]">
            These are protected. The sweeper will not release them however long they sit here,
            because taking a seat back from a family who has paid is the one failure that costs
            a place on the first day of term.
          </p>
        </div>
      )}

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              In progress
              {holds.length > 0 && (
                <span className="ops-pill ops-pill-quiet ml-2 align-middle">{holds.length}</span>
              )}
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              {expired.length > 0
                ? `${expired.length} expired, returning to the pool on the next sweep`
                : "None expired"}
            </p>
          </div>
        </div>

        {holds.length === 0 ? (
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
                {holds.map((h, i) => (
                  <tr key={i}>
                    <td className="font-medium">{h.child}</td>
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
      </section>
    </div>
  );
}

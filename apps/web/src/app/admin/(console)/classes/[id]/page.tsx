import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/money";
import { isUuid } from "@keiki/core/uuid";
import { readAsStaff, classDetail, enrollmentRows, paymentRows } from "@/app/admin/queries";
import { Icon, Pill, Stat, when } from "@/app/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Overview: the answers to the questions somebody rings up with.
 *
 * Deliberately not a dashboard of everything. The roster, the calendar and the
 * ledger each have their own tab and each is a table; this is the page that
 * says how the class is doing in four numbers and who to call, so that the
 * common case never needs a second click.
 */
export default async function ClassOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    cls: (await classDetail(tx, id))[0],
    roster: await enrollmentRows(tx, { classOfferingId: id }),
    payments: await paymentRows(tx, { classOfferingId: id }),
  }));

  if (!data.cls) notFound();

  const c = data.cls;
  const active = data.roster.filter((r) => r.status !== "cancelled");
  const asked = data.roster.filter((r) => r.status === "cancellation_requested");
  const late = data.roster.filter((r) => r.joined_late);
  const care = active.filter((r) => r.in_afterschool_care);

  const collected = data.payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount_cents, 0);
  const refunded = data.payments.reduce((s, p) => s + p.refunded_cents, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon="users"
          tint={c.seats_taken >= c.capacity ? "warn" : "accent"}
          label="Enrolled"
          value={`${active.length}`}
          note={`${c.held} seat${c.held === 1 ? "" : "s"} held mid checkout`}
        />
        <Stat
          icon="calendar"
          tint="violet"
          label="Sessions left"
          value={String(c.sessions_left)}
          note={
            c.next_session_at
              ? when(new Date(c.next_session_at), c.timezone)
              : "term finished"
          }
        />
        <Stat icon="cash" tint="good" label="Collected" value={formatMoney(collected)} />
        <Stat
          icon="undo"
          tint={refunded > 0 ? "warn" : "good"}
          label="Refunded"
          value={formatMoney(refunded)}
        />
      </div>

      {asked.length > 0 && (
        <div className="ops-panel ops-enter p-4" style={{ borderColor: "var(--ops-warn)" }}>
          <p className="flex items-center gap-2 font-medium text-[var(--ops-warn)]">
            <Icon name="warning" size={14} />
            {asked.length} cancellation{asked.length === 1 ? "" : "s"} waiting on a decision
          </p>
          <p className="mt-1 text-[var(--ops-muted)]">
            {asked.map((r) => r.child_name).join(", ")}. Approving one frees the seat and
            sends the refund in the same step.
          </p>
          <Link href="/admin/money?tab=cancellations" className="ops-btn mt-3 inline-flex">
            Open the cancellations queue
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <h2 className="text-[15px] font-semibold">Worth knowing before a session</h2>
          </div>
          <div className="ops-facts">
            <Fact label="In after school care" value={`${care.length} of ${active.length}`}>
              {care.length > 0
                ? "They are collected from care rather than the classroom, so the handover differs."
                : "Everybody is collected from the classroom."}
            </Fact>
            <Fact label="Joined mid term" value={String(late.length)}>
              {late.length > 0
                ? "Paid a full price for a part term, which is what a refund conversation usually starts from."
                : "Everybody started at the first session."}
            </Fact>
            <Fact
              label="Medical or other notes"
              value={String(active.filter((r) => r.notes).length)}
            >
              Held against the child, visible on the Roster tab.
            </Fact>
          </div>
        </section>

        <section className="ops-panel ops-enter">
          <div className="ops-panel-head">
            <h2 className="text-[15px] font-semibold">Recent orders</h2>
          </div>
          {data.payments.length === 0 ? (
            <p className="px-4 py-5 text-[var(--ops-muted)]">No orders yet.</p>
          ) : (
            <table className="ops-table">
              <tbody>
                {data.payments.slice(0, 5).map((p) => (
                  <tr key={p.order_id}>
                    <td>
                      <Link
                        href={`/admin/families/${p.parent_id}`}
                        className="font-medium underline decoration-dotted underline-offset-2"
                      >
                        {p.parent_name}
                      </Link>
                      <p className="ops-mono">{when(new Date(p.created_at))}</p>
                    </td>
                    <td className="ops-num font-medium">{formatMoney(p.amount_cents)}</td>
                    <td>
                      <Pill tone={p.status === "paid" ? "good" : "warn"}>{p.status}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.payments.length > 5 && (
            <div className="ops-panel-head justify-end">
              <Link href={`/admin/classes/${id}/money`} className="ops-btn">
                All {data.payments.length} orders
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ops-fact">
      <div className="flex items-baseline justify-between gap-3">
        <p className="ops-label">{label}</p>
        <p className="font-semibold">{value}</p>
      </div>
      <p className="mt-0.5 text-[var(--ops-muted)]">{children}</p>
    </div>
  );
}

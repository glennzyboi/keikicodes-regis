import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/stripe";
import { isUuid } from "@keiki/core/uuid";
import {
  readAsStaff,
  classDetail,
  enrollmentRows,
  sessionRows,
  paymentRows,
  classRows,
} from "../../queries";
import { EmptyState, Icon, Pill, Stat, when } from "../../ui";
import { SessionControls } from "../../session-controls";
import { TransferChild } from "./transfer";

export const dynamic = "force-dynamic";

/**
 * One class, end to end.
 *
 * The roster, the calendar and the money for that class in one place, because
 * those are the three things anyone asks about a class and they were previously
 * spread across three screens or nowhere at all.
 */
export default async function ClassDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    cls: (await classDetail(tx, id))[0],
    roster: await enrollmentRows(tx, { classOfferingId: id }),
    sessions: await sessionRows(tx, { classOfferingId: id }),
    payments: await paymentRows(tx, { classOfferingId: id }),
    others: await classRows(tx),
  }));

  if (!data.cls) notFound();

  const c = data.cls;
  const active = data.roster.filter((r) => r.status !== "cancelled");
  const reconciles = c.enrolled + c.held === c.seats_taken;
  const pct = Math.round((c.seats_taken / c.capacity) * 100);
  const collected = data.payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount_cents, 0);
  const refunded = data.payments.reduce((s, p) => s + p.refunded_cents, 0);

  const upcoming = data.sessions.filter(
    (s) => s.status === "scheduled" && new Date(s.starts_at) >= new Date(),
  );

  return (
    <div className="space-y-4">
      <Link href="/admin/classes" className="ops-mono inline-flex items-center gap-1">
        &larr; All classes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ops-label">{c.school}</p>
          <h1 className="mt-1 text-[21px] font-semibold">{c.title}</h1>
          <p className="mt-1 text-[var(--ops-muted)]">
            {c.next_session_at
              ? `Next session ${when(new Date(c.next_session_at), c.timezone)}`
              : "No sessions left this term"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!reconciles && (
            <Pill tone="danger">
              <Icon name="warning" size={11} />
              does not reconcile
            </Pill>
          )}
          <Link href={`/register/${c.id}`} target="_blank" className="ops-btn">
            View as a parent
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon="users"
          tint={pct >= 100 ? "warn" : "accent"}
          label="Seats"
          value={`${c.seats_taken}/${c.capacity}`}
          note={`${c.enrolled} enrolled, ${c.held} held`}
        />
        <Stat icon="calendar" tint="violet" label="Sessions left" value={String(c.sessions_left)} />
        <Stat icon="cash" tint="good" label="Collected" value={formatMoney(collected)} />
        <Stat
          icon="undo"
          tint={refunded > 0 ? "warn" : "good"}
          label="Refunded"
          value={formatMoney(refunded)}
        />
      </div>

      <div className="ops-panel ops-enter p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="ops-label">Fill</p>
          <p className="ops-mono">{pct}%</p>
        </div>
        <div className="ops-meter mt-2" data-tone={pct >= 100 ? "full" : undefined}>
          <span style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>

      {/* ---------------------------------------------------------- roster */}
      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Roster
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">{active.length}</span>
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Who is in the room, and who joined after the start
            </p>
          </div>
        </div>

        {data.roster.length === 0 ? (
          <EmptyState icon="users" title="Nobody enrolled yet" note="Registrations will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Child</th>
                  <th>Family</th>
                  <th className="ops-num">Paid</th>
                  <th>Status</th>
                  <th>Move</th>
                </tr>
              </thead>
              <tbody>
                {data.roster.map((r) => (
                  <tr key={r.enrollment_id}>
                    <td className="font-medium">{r.child_name}</td>
                    <td>
                      <Link
                        href={`/admin/families/${r.parent_id}`}
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {r.parent_name}
                      </Link>
                      <p className="ops-mono">{r.parent_email}</p>
                    </td>
                    <td className="ops-num">{formatMoney(r.price_cents)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "active" && <Pill tone="good">enrolled</Pill>}
                        {r.status === "cancellation_requested" && (
                          <Pill tone="warn">cancellation asked</Pill>
                        )}
                        {r.status === "cancelled" && <Pill tone="quiet">cancelled</Pill>}
                        {r.joined_late && <Pill tone="info">joined mid term</Pill>}
                      </div>
                    </td>
                    <td>
                      {r.status !== "cancelled" && (
                        <TransferChild
                          enrollmentId={r.enrollment_id}
                          childName={r.child_name}
                          currentClassId={c.id}
                          classes={data.others.map((o) => ({
                            id: o.id,
                            title: o.title,
                            school: o.school,
                            free: o.capacity - o.seats_taken,
                          }))}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- schedule */}
      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">Schedule</h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Cancelling or moving a date emails everyone enrolled, in the same transaction
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th className="ops-num">#</th>
                <th>Date</th>
                <th>Status</th>
                <th>Note to parents</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.session_id}>
                  <td className="ops-num text-[var(--ops-faint)]">{s.seq}</td>
                  <td>{when(new Date(s.starts_at), s.timezone)}</td>
                  <td>
                    {s.status === "scheduled" && <Pill tone="good">scheduled</Pill>}
                    {s.status === "cancelled" && <Pill tone="danger">cancelled</Pill>}
                    {s.status === "rescheduled" && <Pill tone="quiet">moved</Pill>}
                    {s.rescheduled_from && <Pill tone="info">replacement</Pill>}
                  </td>
                  <td className="text-[var(--ops-muted)]">{s.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {upcoming[0] && (
          <div className="border-t border-[var(--ops-line)] p-4">
            <SessionControls
              sessionId={upcoming[0].session_id}
              label={when(new Date(upcoming[0].starts_at), upcoming[0].timezone)}
            />
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- payments */}
      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Payments for this class
              <span className="ops-pill ops-pill-quiet ml-2 align-middle">
                {data.payments.length}
              </span>
            </h2>
          </div>
        </div>

        {data.payments.length === 0 ? (
          <p className="px-4 py-5 text-[var(--ops-muted)]">No orders yet.</p>
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
      </section>
    </div>
  );
}

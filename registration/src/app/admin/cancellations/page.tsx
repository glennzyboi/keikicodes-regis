import { formatMoney } from "@/lib/stripe";
import { readAsStaff, cancellationRequests } from "../queries";
import { EmptyState, PageHead, Pill, when } from "../ui";
import { declineCancellation } from "../actions";
import { ApproveWithRefund } from "../approve-with-refund";

export const dynamic = "force-dynamic";

export default async function Cancellations() {
  const { data: requests } = await readAsStaff((tx) => cancellationRequests(tx));

  return (
    <div className="space-y-4">
      <PageHead
        title="Cancellations"
        note="A parent asking to cancel does not cancel anything by itself. The seat stays held while you decide, so a family who changes their mind an hour later has not already lost the place, and nobody else can take it in the meantime."
      />

      {requests.length === 0 ? (
        <section className="ops-panel ops-enter">
          <EmptyState
            icon="check"
            title="No open requests"
            note="Nothing is waiting on a decision from the office."
          />
        </section>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
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
                    {r.sessions_remaining} of {r.sessions_total} sessions left
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
          ))}
        </div>
      )}
    </div>
  );
}

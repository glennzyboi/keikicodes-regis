import { formatMoney } from "@/lib/stripe";
import { readAsStaff, refundRows } from "../queries";
import { EmptyState, PageHead, Pill, Stat, refundTone, when } from "../ui";
import { markRefunded, retryRefund } from "../actions";

export const dynamic = "force-dynamic";

export default async function Refunds() {
  const { data: rows } = await readAsStaff((tx) => refundRows(tx));

  const owed = rows.filter((r) => r.refund_owed);
  const failed = owed.filter((r) => r.refund_status === "failed");
  const settled = rows.filter((r) => !r.refund_owed);

  const owedCents = owed.reduce((s, r) => s + (r.refund_amount_cents ?? r.paid_cents), 0);
  const settledCents = settled.reduce((s, r) => s + (r.refund_amount_cents ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHead
        title="Refunds"
        note="Issued through the Stripe API the moment a cancellation is approved, not left as a note for someone to action later. A refund stays on this list until Stripe confirms it succeeded, so one that fails cannot quietly disappear."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon="cash"
          tint={owed.length > 0 ? "warn" : "good"}
          label="Outstanding"
          value={formatMoney(owedCents)}
          note={`${owed.length} not yet confirmed`}
        />
        <Stat
          icon="warning"
          tint={failed.length > 0 ? "danger" : "good"}
          label="Failed at Stripe"
          value={String(failed.length)}
          note={failed.length > 0 ? "needs a human" : "none"}
        />
        <Stat
          icon="check"
          tint="good"
          label="Settled, 30 days"
          value={formatMoney(settledCents)}
          note={`${settled.length} completed`}
        />
      </div>

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <div>
            <h2 className="text-[15px] font-semibold">
              Refund ledger
              {owed.length > 0 && (
                <span className="ops-pill ops-pill-warn ml-2 align-middle">{owed.length} open</span>
              )}
            </h2>
            <p className="mt-0.5 text-[var(--ops-muted)]">
              Retrying reuses the same idempotency key, so a family is never paid twice.
            </p>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="check"
            title="Nothing to refund"
            note="No cancelled registration is owed money."
          />
        ) : (
          <div>
            {rows.map((r) => {
              const amount = r.refund_amount_cents ?? r.paid_cents;
              const status = r.refund_status ?? "not started";
              const partial = amount < r.paid_cents;

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
                        {r.cancelled_at ? ` · cancelled ${when(new Date(r.cancelled_at))}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[17px] font-semibold">{formatMoney(amount)}</p>
                      <p className="ops-mono">
                        {partial ? "partial of " : "full, "}
                        {formatMoney(r.paid_cents)} paid
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Pill tone={refundTone(r.refund_status)}>{status}</Pill>
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
    </div>
  );
}

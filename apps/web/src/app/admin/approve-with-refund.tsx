"use client";

import { useState } from "react";
import { approveCancellation } from "./actions";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/**
 * Approve a cancellation and choose what goes back.
 *
 * Their published refund policy is not something we could find, so this does
 * not invent one. It shows the two amounts a policy would normally land on,
 * with the arithmetic already done, and lets the office decide. Pro rata is
 * charged on sessions still to run.
 *
 * The amount is a real input rather than a fixed choice because the awkward
 * cases are the ones that reach a human: a family who missed two weeks through
 * illness, a class that got cancelled once already.
 */
export function ApproveWithRefund({
  enrollmentId,
  paidCents,
  sessionsTotal,
  sessionsRemaining,
  hasPayment,
}: {
  enrollmentId: string;
  paidCents: number;
  sessionsTotal: number;
  sessionsRemaining: number;
  hasPayment: boolean;
}) {
  const proRata =
    sessionsTotal > 0
      ? Math.min(Math.ceil((paidCents * sessionsRemaining) / sessionsTotal), paidCents)
      : paidCents;

  const [open, setOpen] = useState(false);
  const [cents, setCents] = useState(proRata);

  if (!open) {
    return (
      <button className="ops-btn ops-btn-primary" onClick={() => setOpen(true)}>
        Approve and refund
      </button>
    );
  }

  return (
    <form action={approveCancellation} className="w-full rounded-md border border-[var(--ops-line)] bg-[#fafbfc] p-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="refundCents" value={cents} />

      {!hasPayment && (
        <p className="mb-3 rounded-md bg-[var(--ops-warn-soft)] px-3 py-2 text-[var(--ops-warn)]">
          No Stripe payment is recorded against this registration, so nothing can be
          refunded automatically. Approving will free the seat only.
        </p>
      )}

      <p className="ops-label">Refund amount</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ops-btn"
          data-chosen={cents === paidCents}
          onClick={() => setCents(paidCents)}
        >
          Full {money(paidCents)}
        </button>
        <button
          type="button"
          className="ops-btn"
          data-chosen={cents === proRata}
          onClick={() => setCents(proRata)}
        >
          Pro rata {money(proRata)}
        </button>
        <button
          type="button"
          className="ops-btn"
          data-chosen={cents === 0}
          onClick={() => setCents(0)}
        >
          None
        </button>

        <label className="ml-1 flex items-center gap-1.5">
          <span className="text-[var(--ops-muted)]">$</span>
          <input
            className="ops-field w-24"
            type="number"
            min={0}
            max={paidCents / 100}
            step="0.01"
            value={(cents / 100).toFixed(2)}
            onChange={(e) =>
              setCents(
                Math.max(
                  0,
                  Math.min(Math.round(Number(e.target.value) * 100), paidCents),
                ),
              )
            }
          />
        </label>
      </div>

      <p className="mt-2 text-[var(--ops-muted)]">
        {sessionsRemaining} of {sessionsTotal} sessions still to run, so pro rata is{" "}
        {money(proRata)}. The seat is freed either way.
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" className="ops-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="ops-btn ops-btn-primary">
          {cents > 0 ? `Approve and refund ${money(cents)}` : "Approve without refunding"}
        </button>
      </div>
    </form>
  );
}

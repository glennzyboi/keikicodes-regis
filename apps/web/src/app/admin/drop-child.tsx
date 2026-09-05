"use client";

import { useState } from "react";
import { DROP_REASONS } from "@keiki/core/schedule-reasons";
import { Modal } from "@/components/modal";
import { dropFromClass } from "./actions";

/**
 * Taking a child off a roster, without it being a refund.
 *
 * The build spec lists "kids sometimes join mid-semester, or drop" separately
 * from cancellations and refunds, and it is right to. A cancellation is a family
 * asking and waiting on an answer. A drop is the office recording that a child
 * stopped coming, which is usually a phone call, sometimes nothing at all, and
 * frequently involves no money: they came to eight of the ten sessions.
 *
 * Without this the only way to clear a roster was to approve a cancellation,
 * which meant either paying back money nobody asked for or leaving the child
 * and their seat in place all term. Both of those happened.
 *
 * The refund, if there is one, is a separate decision on the Money tab. That
 * separation is the whole point: the operational fact and the financial one are
 * recorded independently, because they genuinely are independent.
 */
export function DropChild({
  enrollmentId,
  childName,
  sessions,
}: {
  enrollmentId: string;
  childName: string;
  /** Remaining sessions, so "from which week" is a pick rather than a date. */
  sessions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ops-btn" onClick={() => setOpen(true)}>
        Drop
      </button>

      {open && (
        <Modal
          title={`Drop ${childName} from this class`}
          tone="ops"
          onClose={() => setOpen(false)}
        >
          <form action={dropFromClass} className="space-y-3">
            <input type="hidden" name="enrollmentId" value={enrollmentId} />

            <div>
              <label htmlFor="drop-reason" className="ops-label">
                Why
              </label>
              <select id="drop-reason" name="reasonCode" className="ops-field w-full" required>
                {DROP_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="drop-from" className="ops-label">
                First session they will miss
              </label>
              <select id="drop-from" name="fromSessionId" className="ops-field w-full">
                <option value="">Not sure, or they never started</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[var(--ops-muted)]">
                With the session they joined on, this is what lets the roster say
                &ldquo;week 3 to week 8&rdquo;, which is where a pro rata conversation starts.
              </span>
            </div>

            <div>
              <label htmlFor="drop-note" className="ops-label">
                Anything worth writing down
              </label>
              <textarea
                id="drop-note"
                name="note"
                rows={2}
                className="ops-field ops-field-area w-full"
                placeholder="Mum rang, moving to Maui at half term."
              />
            </div>

            <p className="ops-note">
              The seat is freed straight away. No money moves: if a refund is owed, issue it
              from Money, where the amount is a decision somebody makes on purpose.
            </p>

            <div className="flex gap-2">
              <button className="ops-btn ops-btn-danger">Drop from class</button>
              <button type="button" className="ops-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

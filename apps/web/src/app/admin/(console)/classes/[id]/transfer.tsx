"use client";

import { useState } from "react";
import { transferEnrollment } from "@/app/admin/actions";

/**
 * Move a child to another class mid term.
 *
 * The seat is taken in the destination before it is released in the origin, in
 * one transaction, so a transfer can never oversell the class it moves into and
 * can never drop a child between the two.
 *
 * Money is untouched on purpose. Classes are priced differently, and whether a
 * move is a refund, a top up or a goodwill gesture is a decision for a person.
 */
export function TransferChild({
  enrollmentId,
  childName,
  currentClassId,
  classes,
}: {
  enrollmentId: string;
  childName: string;
  currentClassId: string;
  classes: { id: string; title: string; school: string; free: number }[];
}) {
  const [open, setOpen] = useState(false);
  const options = classes.filter((c) => c.id !== currentClassId);

  if (!open) {
    return (
      <button className="ops-btn" onClick={() => setOpen(true)}>
        Move
      </button>
    );
  }

  return (
    <form action={transferEnrollment} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <select
        name="toClassId"
        className="ops-field"
        required
        defaultValue=""
        aria-label={`Move ${childName} to`}
      >
        <option value="" disabled>
          Move to
        </option>
        {options.map((c) => (
          <option key={c.id} value={c.id} disabled={c.free <= 0}>
            {c.title} · {c.school} {c.free <= 0 ? "(full)" : `(${c.free} free)`}
          </option>
        ))}
      </select>
      <button className="ops-btn ops-btn-primary">Move</button>
      <button type="button" className="ops-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

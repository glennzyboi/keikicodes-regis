"use client";

import { useState } from "react";
import { cancelSession, rescheduleSession } from "./actions";

/**
 * Cancel or move one date of a class.
 *
 * Folded away by default. An instructor calling in sick is a rare event, and a
 * date picker sitting open on every class turns a page staff read every morning
 * into a page they have to look past.
 */
export function SessionControls({ sessionId, label }: { sessionId: string; label: string }) {
  const [open, setOpen] = useState<"none" | "cancel" | "move">("none");

  if (open === "none") {
    return (
      <div className="mt-4 flex justify-end gap-2 border-t border-[var(--ops-line-soft)] pt-4">
        <button className="ops-btn" onClick={() => setOpen("cancel")}>
          Cancel next class
        </button>
        <button className="ops-btn" onClick={() => setOpen("move")}>
          Move next class
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-[var(--ops-line-soft)] pt-4">
      <p className="text-[var(--ops-muted)]">
        {open === "cancel" ? "Cancel" : "Move"} the class on {label}. Everyone keeps their
        place either way, only this date changes.
      </p>

      <form
        action={open === "cancel" ? cancelSession : rescheduleSession}
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="sessionId" value={sessionId} />

        {open === "move" && (
          <div>
            <label htmlFor={`date-${sessionId}`} className="ops-label">
              New date
            </label>
            <input
              id={`date-${sessionId}`}
              name="newDate"
              type="date"
              required
              className="ops-field"
            />
          </div>
        )}

        <div className="flex-1 min-w-48">
          <label htmlFor={`note-${sessionId}`} className="ops-label">
            What should parents be told?
          </label>
          <input
            id={`note-${sessionId}`}
            name="note"
            className="ops-field"
            placeholder="Instructor out sick"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="ops-btn"
            onClick={() => setOpen("none")}
          >
            Never mind
          </button>
          <button className="ops-btn ops-btn-primary">
            {open === "cancel" ? "Cancel this date" : "Move it"}
          </button>
        </div>
      </form>
    </div>
  );
}

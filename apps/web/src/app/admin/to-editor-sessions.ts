import { CANCEL_REASON_LABELS } from "@keiki/core/schedule-reasons";
import type { SessionRow } from "./queries";
import type { EditorSession } from "./schedule-editor";

/**
 * Database rows to something the schedule editor can render.
 *
 * Done on the server on purpose. Formatting a date in a campus's own timezone
 * needs `Intl` with an explicit zone, and doing it in the browser means the
 * first render uses the visitor's zone and the second uses Honolulu's, which is
 * a hydration mismatch on every row. Formatting once here also keeps the
 * Postgres `Date` objects, which serialise badly, off the wire.
 *
 * `postgres.js` returns a real `Date` for a `date` column, built at UTC
 * midnight, so `String(d).slice(0, 10)` gives "Tue Aug 25". That took a page
 * down once already; `isoDay` is the fix and everything goes through it.
 */
function isoDay(value: Date | string): string {
  return value instanceof Date
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
        value.getUTCDate(),
      ).padStart(2, "0")}`
    : String(value).slice(0, 10);
}

export function toEditorSessions(rows: SessionRow[]): {
  rows: EditorSession[];
  defaultStart: string;
  defaultEnd: string;
} {
  const now = Date.now();
  const first = rows[0];

  return {
    // An <input type="time"> wants HH:MM. Postgres gives HH:MM:SS.
    defaultStart: (first?.start_time ?? "15:00").slice(0, 5),
    defaultEnd: (first?.end_time ?? "16:00").slice(0, 5),
    rows: rows.map((s) => ({
      id: s.session_id,
      seq: s.seq,
      date: isoDay(s.session_date),
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: s.timezone,
      }).format(new Date(s.starts_at)),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: s.timezone,
      }).format(new Date(s.starts_at)),
      status: s.status as EditorSession["status"],
      reasonCode: s.cancel_reason_code,
      reasonLabel: s.cancel_reason_code
        ? (CANCEL_REASON_LABELS[s.cancel_reason_code] ?? s.cancel_reason_code)
        : null,
      note: s.note,
      isReplacement: Boolean(s.rescheduled_from),
      fromBlackout: s.from_blackout,
      manual: s.origin === "manual",
      past: new Date(s.starts_at).getTime() < now,
      changedBy: s.changed_by_name,
    })),
  };
}

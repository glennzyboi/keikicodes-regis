"use client";

import { useId, useMemo, useState } from "react";

/**
 * A date field that works on every device.
 *
 * `<input type="date">` is the right primitive and it has two real problems.
 * On desktop the picker is a small OS widget with a tiny year control, so
 * entering a birthday in 2017 means clicking back a hundred and something
 * months. And its display format follows the operating system, so the same
 * page reads dd/mm/yyyy for one parent and mm/dd/yyyy for another, with no way
 * to tell which you are looking at.
 *
 * This keeps the native input, because on a phone the native wheel is far
 * better than anything reimplemented, and adds three explicit selects for the
 * cases where it is not. Both write to one hidden field in ISO form, which is
 * the only format that ever reaches the server.
 *
 * The selects are the primary control on small screens and desktop alike for
 * birthdays, because choosing a year from a list beats paging a calendar
 * backwards ten years. The native picker stays available for anyone who
 * prefers it.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysIn(year: number, month: number) {
  if (!year || !month) return 31;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function DateField({
  name,
  label,
  hint,
  required,
  defaultValue,
  value: controlledValue,
  onChange,
  /** Range of years offered. Birthdays look backwards; a reschedule looks forward. */
  yearsBack = 20,
  yearsForward = 0,
  className = "",
}: {
  /** Omit when controlled: the hidden input is only for FormData submissions. */
  name?: string;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  /** Controlled mode, for forms that build their payload from React state. */
  value?: string;
  onChange?: (next: string) => void;
  yearsBack?: number;
  yearsForward?: number;
  className?: string;
}) {
  const id = useId();

  /**
   * The three parts are the state, not the ISO string.
   *
   * Deriving them from the value looks tidier and is wrong: a complete date is
   * the only thing that serialises, so choosing a month before a year would
   * produce an empty value, which would feed back and blank the month the user
   * just picked. Partial input has to survive, so it is held here and only
   * published once all three exist.
   */
  const initial = defaultValue ?? controlledValue ?? "";
  const [parts, setParts] = useState(() => ({
    y: initial.slice(0, 4),
    m: initial.slice(5, 7),
    d: initial.slice(8, 10),
  }));
  const [uncontrolled, setUncontrolled] = useState(initial);

  const controlled = controlledValue !== undefined;
  const value = controlled ? controlledValue : uncontrolled;

  const { y, m, d } = parts;

  // Computed once. Deriving the current year on every render is an impure read,
  // and the list does not change while the page is open.
  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    const out: number[] = [];
    for (let year = now + yearsForward; year >= now - yearsBack; year--) out.push(year);
    return out;
  }, [yearsBack, yearsForward]);

  const maxDay = daysIn(Number(y), Number(m));

  function publish(next: { y: string; m: string; d: string }) {
    const complete = next.y && next.m && next.d;
    const iso = complete ? `${next.y}-${next.m}-${next.d}` : "";
    if (!controlled) setUncontrolled(iso);
    onChange?.(iso);
  }

  function setPart(part: "y" | "m" | "d", raw: string) {
    const next = { ...parts, [part]: raw };

    // Clamp the day when the month shortens under it. Letting the browser roll
    // 31 February into 3 March silently is worse than moving it to the 28th
    // where the person can see what happened.
    if (next.y && next.m && next.d) {
      const limit = daysIn(Number(next.y), Number(next.m));
      if (Number(next.d) > limit) next.d = String(limit).padStart(2, "0");
    }

    setParts(next);
    publish(next);
  }

  /** The native picker sets all three at once. */
  function setWhole(iso: string) {
    const next = { y: iso.slice(0, 4), m: iso.slice(5, 7), d: iso.slice(8, 10) };
    setParts(next);
    publish(next);
  }

  return (
    <div className={className}>
      <label htmlFor={`${id}-native`} className="kc-label">
        {label}
      </label>

      {/* The value that is actually submitted. Always ISO, never locale. */}
      {name && <input type="hidden" name={name} value={value} />}

      <div className="df-parts">
        <select
          className="kc-field df-month"
          aria-label={`${label}, month`}
          value={m}
          required={required}
          onChange={(e) => setPart("m", e.target.value)}
        >
          <option value="">Month</option>
          {MONTHS.map((label, i) => (
            <option key={label} value={String(i + 1).padStart(2, "0")}>
              {label}
            </option>
          ))}
        </select>

        <select
          className="kc-field df-day"
          aria-label={`${label}, day`}
          value={d}
          required={required}
          onChange={(e) => setPart("d", e.target.value)}
        >
          <option value="">Day</option>
          {Array.from({ length: maxDay }, (_, i) => (
            <option key={i + 1} value={String(i + 1).padStart(2, "0")}>
              {i + 1}
            </option>
          ))}
        </select>

        <select
          className="kc-field df-year"
          aria-label={`${label}, year`}
          value={y}
          required={required}
          onChange={(e) => setPart("y", e.target.value)}
        >
          <option value="">Year</option>
          {years.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <details className="df-native">
        <summary>Use the calendar picker instead</summary>
        <input
          id={`${id}-native`}
          type="date"
          className="kc-field mt-2"
          value={value}
          onChange={(e) => setWhole(e.target.value)}
          aria-label={label}
        />
      </details>

      {hint && <p className="df-hint">{hint}</p>}
    </div>
  );
}

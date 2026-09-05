"use client";

import { useId, useRef, useState } from "react";

/**
 * A date you already know, typed.
 *
 * This replaces three `<select>`s, and the reason is what the field is for. A
 * birthday is not a date you look up, it is a date you know by heart, and the
 * fastest way to enter something you know by heart is to type it. Dropdowns
 * make you hunt: the year list ran twenty deep in reverse order, so a child born
 * in 2017 was nine rows down a list somebody had to read.
 *
 * So: three number boxes, day then month then year, which is the pattern the
 * GOV.UK Design System and Stripe both landed on for exactly this. Typing two
 * digits moves you on. Backspace at the start of a box moves you back. Pasting
 * "05/05/2016" into any of them fills all three, because people paste.
 *
 * `<input type="date">` is still here as a secondary control rather than being
 * the primary one, and it is a real button now instead of the fine print it
 * used to be. On a phone the native wheel is genuinely better than anything
 * reimplemented; on a desktop it opens a calendar on today's month, which for a
 * birthday means paging back a hundred and something times.
 *
 * `inputMode="numeric"` rather than `type="number"`: number inputs bring
 * spinners nobody wants on a birthday, scroll-wheel accidents, and a locale
 * dependent idea of what counts as a number. `pattern` gives phones the numeric
 * keypad without any of that.
 *
 * Everything still writes one ISO string through `onChange`, so nothing
 * upstream changes.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysIn(year: number, month: number) {
  if (!year || !month) return 31;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const digits = (v: string) => v.replace(/[^0-9]/g, "");

export function DateField({
  name,
  label,
  hint,
  required,
  defaultValue,
  value: controlledValue,
  onChange,
  yearsBack = 20,
  yearsForward = 0,
  className = "",
}: {
  name?: string;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (iso: string) => void;
  yearsBack?: number;
  yearsForward?: number;
  className?: string;
}) {
  const id = useId();
  const controlled = controlledValue !== undefined;
  const initial = (controlled ? controlledValue : defaultValue) ?? "";

  const split = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? { y: m[1], m: m[2], d: m[3] } : { y: "", m: "", d: "" };
  };

  const [parts, setParts] = useState(() => split(initial));
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  // A controlled value changing underneath us, which is what happens when the
  // registration form swaps in a child already on file.
  //
  // Adjusted during render against the previous prop rather than in an effect.
  // This is React's own documented pattern for it, and it avoids the second
  // render an effect costs, during which the field would briefly show the old
  // child's birthday.
  const [seen, setSeen] = useState(controlledValue);
  if (controlled && controlledValue !== seen) {
    setSeen(controlledValue);
    setParts(split(controlledValue ?? ""));
  }

  const now = new Date();
  const minYear = now.getUTCFullYear() - yearsBack;
  const maxYear = now.getUTCFullYear() + yearsForward;

  const iso =
    parts.y.length === 4 && parts.m.length > 0 && parts.d.length > 0
      ? `${parts.y}-${parts.m.padStart(2, "0")}-${parts.d.padStart(2, "0")}`
      : "";

  function publish(next: { y: string; m: string; d: string }) {
    setParts(next);
    const complete =
      next.y.length === 4 && next.m.length > 0 && next.d.length > 0
        ? `${next.y}-${next.m.padStart(2, "0")}-${next.d.padStart(2, "0")}`
        : "";
    onChange?.(complete);
  }

  /** "05/05/2016", "5-5-2016" or "2016-05-05" pasted into any of the boxes. */
  function tryPaste(text: string): boolean {
    const nums = text.match(/\d+/g);
    if (!nums || nums.length < 3) return false;
    const [a, b, c] = nums;
    const next =
      a.length === 4
        ? { y: a, m: b.padStart(2, "0"), d: c.padStart(2, "0") }
        : { d: a.padStart(2, "0"), m: b.padStart(2, "0"), y: c };
    if (next.y.length !== 4) return false;
    publish(next);
    yearRef.current?.focus();
    return true;
  }

  function setPart(key: "d" | "m" | "y", raw: string, advanceTo?: HTMLInputElement | null) {
    const max = key === "y" ? 4 : 2;
    const v = digits(raw).slice(0, max);
    const next = { ...parts, [key]: v };

    // 31 January to February should not silently mean 31 February. Clamp only
    // once both are known, so typing does not fight the person doing it.
    if ((key === "m" || key === "y") && next.d) {
      const limit = daysIn(Number(next.y || 2000), Number(next.m || 0));
      if (Number(next.d) > limit) next.d = String(limit).padStart(2, "0");
    }

    publish(next);

    // Move on once this box cannot take more. Two digits for day and month; a
    // leading digit above 3 (day) or 1 (month) can only be a whole value.
    const full =
      v.length === max ||
      (key === "d" && v.length === 1 && Number(v) > 3) ||
      (key === "m" && v.length === 1 && Number(v) > 1);
    if (full && advanceTo) advanceTo.focus();
  }

  function onKeyDown(key: "d" | "m" | "y", back: HTMLInputElement | null) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      // Backspace at the very start steps back to the previous box, which is
      // what everybody expects and almost nothing implements.
      if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && back) {
        e.preventDefault();
        back.focus();
        back.setSelectionRange(back.value.length, back.value.length);
        return;
      }
      if (e.key === "ArrowLeft" && el.selectionStart === 0 && back) {
        e.preventDefault();
        back.focus();
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.key === "ArrowUp" ? 1 : -1;
        const max = key === "y" ? maxYear : key === "m" ? 12 : daysIn(Number(parts.y), Number(parts.m));
        const min = key === "y" ? minYear : 1;
        const current = Number(parts[key]) || (step > 0 ? min - 1 : max + 1);
        const value = Math.min(max, Math.max(min, current + step));
        publish({ ...parts, [key]: String(value).padStart(key === "y" ? 4 : 2, "0") });
      }
    };
  }

  // What they have actually entered, written out. A birthday typed as digits is
  // easy to get subtly wrong, and "5 May 2016" underneath is the cheapest
  // possible confirmation that it landed the way they meant.
  const readable =
    iso &&
    Number(parts.m) >= 1 &&
    Number(parts.m) <= 12 &&
    Number(parts.d) >= 1 &&
    Number(parts.d) <= daysIn(Number(parts.y), Number(parts.m))
      ? `${Number(parts.d)} ${MONTH_NAMES[Number(parts.m) - 1]} ${parts.y}`
      : null;

  const outOfRange = parts.y.length === 4 && (Number(parts.y) < minYear || Number(parts.y) > maxYear);

  const box = (
    key: "d" | "m" | "y",
    ref: React.RefObject<HTMLInputElement | null>,
    next: React.RefObject<HTMLInputElement | null> | null,
    back: React.RefObject<HTMLInputElement | null> | null,
    text: string,
    placeholder: string,
  ) => (
    <span className="df-box">
      <label htmlFor={`${id}-${key}`} className="df-box-label">
        {text}
      </label>
      <input
        ref={ref}
        id={`${id}-${key}`}
        className={`kc-field df-${key}`}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={key === "d" ? "bday-day" : key === "m" ? "bday-month" : "bday-year"}
        maxLength={key === "y" ? 4 : 2}
        placeholder={placeholder}
        aria-label={`${label}, ${key === "d" ? "day" : key === "m" ? "month" : "year"}`}
        value={parts[key]}
        onChange={(e) => setPart(key, e.target.value, next?.current)}
        onKeyDown={onKeyDown(key, back?.current ?? null)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (tryPaste(text)) e.preventDefault();
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
    </span>
  );

  return (
    <div className={`df ${className}`}>
      {/* Points at the day box, which is the first thing you type into. It used
          to point at a native input hidden inside a collapsed <details>, so
          clicking the label focused something nobody could see. */}
      <label className="kc-label" htmlFor={`${id}-d`}>
        {label}
      </label>

      {/* The anchor the form's error summary scrolls to. It wraps the control
          rather than trailing after it as an empty span. */}
      <div className="df-parts" id={`${id}-parts`} tabIndex={-1}>
        {box("d", dayRef, monthRef, null, "Day", "DD")}
        {box("m", monthRef, yearRef, dayRef, "Month", "MM")}
        {box("y", yearRef, null, monthRef, "Year", "YYYY")}
      </div>

      <div className="df-foot">
        {readable && !outOfRange && <span className="df-readable">{readable}</span>}
        {outOfRange && (
          <span className="df-readable df-readable-off">
            Year should be between {minYear} and {maxYear}
          </span>
        )}

        {/* A real secondary control, not fine print. It used to be a dotted
            underline inside a <details> that read as a footnote. */}
        <label className="df-native">
          <span>Pick from a calendar</span>
          <input
            type="date"
            aria-label={`${label}, calendar`}
            value={iso}
            max={`${maxYear}-12-31`}
            min={`${minYear}-01-01`}
            onChange={(e) => publish(split(e.target.value))}
          />
        </label>
      </div>

      {hint && <p className="df-hint">{hint}</p>}
      {name && <input type="hidden" name={name} value={iso} required={required} />}
    </div>
  );
}

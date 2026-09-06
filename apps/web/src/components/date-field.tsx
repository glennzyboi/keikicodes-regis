"use client";

import { useId, useState } from "react";

/**
 * A date of birth, as three dropdowns.
 *
 * This replaces three typed boxes, and the reason is a bug rather than a
 * preference. The typed version emitted `""` through `onChange` whenever the
 * date was incomplete, the registration form wrote that back as the controlled
 * value, and the resync branch then treated it as "the parent handed me
 * something new" and cleared all three boxes. So deleting one digit of a
 * finished birthday wiped the whole field, which is exactly the "it resets
 * itself" people reported. Selects have no partial state to be incomplete, so
 * the failure cannot happen by construction, and the resync is now precise
 * anyway.
 *
 * The old comment argued that a birthday is known by heart and typing is
 * fastest. That is true and it was still the wrong trade: a field that is
 * marginally quicker when it works and destroys your input when it does not is
 * a worse field. Three selects are boring, and boring is the correct ambition
 * for the last thing standing between a parent and a payment.
 *
 * Two details that make dropdowns bearable here, since the usual complaint is
 * hunting through a long list:
 *
 *   - **Years run most recent first** and only cover plausible ages, so a child
 *     born in 2017 is near the top rather than nineteen rows down.
 *   - **Months are names**, so there is no MM/DD versus DD/MM ambiguity to get
 *     wrong. The old numeric boxes had a US-versus-everywhere-else problem
 *     sitting in them that no amount of placeholder text fixes.
 *
 * The day list shortens to fit the month and year, so 31 February is not
 * offerable rather than being corrected after the fact.
 *
 * `<input type="date">` stays as a secondary control. On a phone the native
 * wheel beats anything reimplemented.
 *
 * Everything still writes one ISO string through `onChange`, so nothing
 * upstream changes.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysIn(year: number, month: number) {
  if (!month) return 31;
  // Year 2000 is a leap year, so an unknown year offers 29 February rather than
  // hiding a valid date from somebody who has not picked a year yet.
  return new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();
}

type Parts = { y: string; m: string; d: string };

const split = (iso: string): Parts => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { y: m[1], m: m[2], d: m[3] } : { y: "", m: "", d: "" };
};

const join = (p: Parts) =>
  p.y.length === 4 && p.m && p.d ? `${p.y}-${p.m.padStart(2, "0")}-${p.d.padStart(2, "0")}` : "";

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

  const [parts, setParts] = useState<Parts>(() => split(initial));

  /**
   * The last value this field emitted.
   *
   * This is what stops the field wiping itself. An incomplete date emits `""`,
   * the form stores it, and it comes back as the controlled value; without this
   * the resync below cannot tell that apart from the form genuinely handing us
   * a different child, and clears every box. Comparing against what we sent
   * means we only resync when the value came from somewhere other than us.
   *
   * State rather than a ref, because it is read and written during render as
   * part of the adjustment below, which is exactly what refs are not for.
   */
  const [emitted, setEmitted] = useState(initial);

  // Adjusting state during render, which is React's own documented pattern for
  // a controlled value changing underneath a component. An effect would cost a
  // second render during which the field shows the previous child's birthday.
  const [seen, setSeen] = useState(controlledValue);
  if (controlled && controlledValue !== seen) {
    setSeen(controlledValue);
    if (controlledValue !== emitted) {
      setParts(split(controlledValue ?? ""));
      setEmitted(controlledValue ?? "");
    }
  }

  const now = new Date();
  const maxYear = now.getUTCFullYear() + yearsForward;
  const minYear = now.getUTCFullYear() - yearsBack;

  function publish(next: Parts) {
    // Never offer a day the month cannot have. Clamping here rather than
    // rejecting later means picking February after choosing the 31st moves you
    // to the 29th instead of silently holding an impossible date.
    const limit = daysIn(Number(next.y), Number(next.m));
    if (next.d && Number(next.d) > limit) next.d = String(limit).padStart(2, "0");

    setParts(next);
    const iso = join(next);
    setEmitted(iso);
    onChange?.(iso);
  }

  const iso = join(parts);
  const dayCount = daysIn(Number(parts.y), Number(parts.m));

  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const readable = iso ? `${Number(parts.d)} ${MONTHS[Number(parts.m) - 1]} ${parts.y}` : null;

  return (
    <div className={`df ${className}`}>
      <label className="kc-label" htmlFor={`${id}-d`}>
        {label}
      </label>

      {/* The anchor the form's error summary scrolls to. */}
      <div className="df-parts" id={`${id}-parts`} tabIndex={-1}>
        <span className="df-box">
          <label htmlFor={`${id}-d`} className="df-box-label">Day</label>
          <select
            id={`${id}-d`}
            className="kc-field df-select df-d"
            autoComplete="bday-day"
            aria-label={`${label}, day`}
            value={parts.d}
            onChange={(e) => publish({ ...parts, d: e.target.value })}
          >
            <option value="">Day</option>
            {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d).padStart(2, "0")}>{d}</option>
            ))}
          </select>
        </span>

        <span className="df-box df-box-month">
          <label htmlFor={`${id}-m`} className="df-box-label">Month</label>
          <select
            id={`${id}-m`}
            className="kc-field df-select df-m"
            autoComplete="bday-month"
            aria-label={`${label}, month`}
            value={parts.m}
            onChange={(e) => publish({ ...parts, m: e.target.value })}
          >
            <option value="">Month</option>
            {MONTHS.map((label, i) => (
              <option key={label} value={String(i + 1).padStart(2, "0")}>{label}</option>
            ))}
          </select>
        </span>

        <span className="df-box">
          <label htmlFor={`${id}-y`} className="df-box-label">Year</label>
          <select
            id={`${id}-y`}
            className="kc-field df-select df-y"
            autoComplete="bday-year"
            aria-label={`${label}, year`}
            value={parts.y}
            onChange={(e) => publish({ ...parts, y: e.target.value })}
          >
            <option value="">Year</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </span>
      </div>

      <div className="df-foot">
        {readable && <span className="df-readable">{readable}</span>}

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

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./ui";

/**
 * One filter bar, used by every list in the console.
 *
 * Three decisions, and the reasons matter more than the code.
 *
 * **It applies on touch, with no Apply button.** Every list here used to be a
 * GET form with a Search button next to it, which is a design from a decade of
 * full page reloads. Choosing a campus and then having to find and press a
 * second control is one extra step on the single most repeated action in the
 * console, and it is the step people forget, so they stare at unfiltered rows
 * wondering why the filter did nothing. Selects fire immediately; typing is
 * debounced by 250ms, which is long enough not to fire per keystroke and short
 * enough that nobody reaches for a button.
 *
 * **The URL is the state, not this component.** Staff paste console links to
 * each other constantly, and "the Wai'alae classes that still have seats"
 * should open the same view for whoever receives it. It also means back works,
 * a refresh keeps your place, and the server does the filtering, so this stays
 * correct at 28 classes and at 2,800. A client side filter over a page of rows
 * would silently only search the page you can see, which is the kind of wrong
 * that nobody notices until it matters.
 *
 * **Active filters are chips you can take off.** A row of selects showing their
 * current value is readable one control at a time; a row of chips is readable
 * at a glance, and answers "why am I only seeing four classes" without making
 * anyone audit five dropdowns.
 *
 * Changing anything drops `page`. Staying on page 4 of a list you have just
 * re-filtered shows rows that have nothing to do with what you clicked, and
 * frequently shows nothing at all, which reads as "no results" rather than as
 * "you are past the end".
 */

export type FilterOption = { value: string; label: string };

export type FilterSelect = {
  name: string;
  label: string;
  value?: string;
  options: FilterOption[];
  /** What the empty choice says. Defaults to "All <label>". */
  anyLabel?: string;
  /**
   * This filter has no "unset" state, only a widest one.
   *
   * Term is the case. The list defaults to the current term because that is the
   * only one anybody is fielding calls about, and an unfiltered list of every
   * class that ever ran is nobody's question. But a default that is invisible
   * is a lie about what you are looking at, so it still shows as a chip, and
   * taking the chip off moves to `clearTo` ("all") rather than to nothing,
   * which would just put the default straight back.
   */
  clearTo?: string;
};

/** A small either/or, rendered as a segmented control rather than a dropdown. */
export type FilterSegment = {
  name: string;
  label: string;
  value: string;
  options: FilterOption[];
};

export function FilterBar({
  basePath,
  search,
  selects = [],
  segment,
  children,
}: {
  basePath: string;
  search?: { name?: string; value?: string; placeholder: string };
  selects?: FilterSelect[];
  segment?: FilterSegment;
  /** Anything that belongs on the bar but is not a filter, such as "New class". */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const qName = search?.name ?? "q";
  const qValue = search?.value ?? "";

  const [text, setText] = useState(qValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The box follows the URL when the URL changes underneath it, which is what
  // happens when somebody takes the search chip off or presses Clear all.
  // Adjusted during render against the previous prop rather than in an effect:
  // it is React's own documented pattern, and it avoids the extra render an
  // effect costs, during which the box would still show the old text.
  const [seen, setSeen] = useState(qValue);
  if (qValue !== seen) {
    setSeen(qValue);
    setText(qValue);
  }

  function push(changes: Record<string, string | undefined>, keepPage = false) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete("page");

    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    });
  }

  function onText(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ [qName]: value || undefined }), 250);
  }

  const chips: { key: string; name: string; label: string; to?: string }[] = [
    ...(qValue ? [{ key: qName, name: qName, label: `“${qValue}”` }] : []),
    ...selects.flatMap((s) => {
      if (!s.value || s.value === s.clearTo) return [];
      const chosen = s.options.find((o) => o.value === s.value);
      return chosen
        ? [{ key: s.name, name: s.name, label: `${s.label}: ${chosen.label}`, to: s.clearTo }]
        : [];
    }),
  ];

  function clearAll() {
    const next = new URLSearchParams(params.toString());
    next.delete(qName);
    for (const s of selects) {
      if (s.clearTo) next.set(s.name, s.clearTo);
      else next.delete(s.name);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    });
  }

  return (
    <div className="ops-filters" data-pending={pending || undefined}>
      <div className="ops-filters-row">
        {search && (
          <div className="ops-fsearch">
            <span className="ops-fsearch-icon" aria-hidden>
              <Icon name="search" size={14} />
            </span>
            <input
              className="ops-field ops-fsearch-input"
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder={search.placeholder}
              aria-label="Search"
              type="search"
            />
          </div>
        )}

        {selects.map((s) => (
          <label key={s.name} className="ops-filter">
            <span className="sr-only">{s.label}</span>
            <select
              className="ops-field ops-filter-select"
              value={s.value ?? ""}
              onChange={(e) => push({ [s.name]: e.target.value || undefined })}
              data-set={s.value && s.value !== s.clearTo ? "true" : undefined}
            >
              {!s.clearTo && (
                <option value="">{s.anyLabel ?? `All ${s.label.toLowerCase()}`}</option>
              )}
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {segment && (
          <div className="ops-seg" role="group" aria-label={segment.label}>
            {segment.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="ops-seg-btn"
                data-chosen={segment.value === o.value || undefined}
                aria-pressed={segment.value === o.value}
                // The view is not a filter, so it keeps your place in the list.
                onClick={() => push({ [segment.name]: o.value }, true)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {children && <div className="ops-filters-end">{children}</div>}
      </div>

      {chips.length > 0 && (
        <div className="ops-chips">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="ops-chip"
              onClick={() => push({ [c.name]: c.to })}
            >
              {c.label}
              <span className="ops-chip-x" aria-hidden>
                <Icon name="close" size={11} />
              </span>
              <span className="sr-only">, remove this filter</span>
            </button>
          ))}
          {chips.length > 1 && (
            <button type="button" className="ops-chip ops-chip-clear" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

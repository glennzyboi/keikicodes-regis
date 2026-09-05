"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./ui";

/**
 * Finding one class among hundreds, by typing.
 *
 * The calendar's class filter was a plain `<select>`, and a select is fine for
 * eight options and useless for four hundred: it opens a list you scroll with no
 * way to search it, and the same curriculum appears under one title at five
 * campuses, so the thing you are hunting for looks identical to four things you
 * do not want.
 *
 * This is a combobox instead. Type any part of the title, the campus or the day
 * and the list narrows; arrow keys and Enter work, because somebody using this
 * every morning will not reach for the mouse.
 *
 * The choice still lands in the URL, exactly as the dropdown did, so a filtered
 * calendar stays a link somebody can send.
 */
export function ClassPicker({
  classes,
  value,
  basePath,
  label = "Class",
}: {
  classes: { id: string; title: string; school: string; day: string }[];
  value?: string;
  basePath: string;
  label?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const chosen = classes.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? classes.filter((c) =>
          `${c.title} ${c.school} ${c.day}`.toLowerCase().includes(q),
        )
      : classes;
    // Capped, because rendering four hundred options is slow and nobody reads
    // past the first handful anyway: if it is not in the top twenty, type more.
    return pool.slice(0, 20);
  }, [classes, query]);

  function choose(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("class", id);
    else next.delete("class");
    next.delete("page");
    setOpen(false);
    setQuery("");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false }));
  }

  return (
    <div className="ops-picker" ref={boxRef}>
      <span className="sr-only" id="class-picker-label">
        {label}
      </span>

      {chosen && !open ? (
        <button
          type="button"
          className="ops-field ops-picker-chosen"
          onClick={() => setOpen(true)}
          aria-labelledby="class-picker-label"
        >
          <span className="truncate">
            {chosen.title} · {chosen.school}
          </span>
          <span
            className="ops-picker-x"
            role="button"
            tabIndex={0}
            aria-label="Show every class"
            onClick={(e) => {
              e.stopPropagation();
              choose(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                choose(null);
              }
            }}
          >
            <Icon name="close" size={11} />
          </span>
        </button>
      ) : (
        <div className="ops-picker-field">
          <span className="ops-picker-icon" aria-hidden>
            <Icon name="search" size={14} />
          </span>
          <input
            className="ops-field ops-picker-input"
            role="combobox"
            aria-expanded={open}
            aria-controls="class-picker-list"
            aria-autocomplete="list"
            aria-labelledby="class-picker-label"
            placeholder="Any class, campus or day"
            value={query}
            autoFocus={open}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // After the click on an option has had a chance to land.
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && open && matches[active]) {
                e.preventDefault();
                choose(matches[active].id);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </div>
      )}

      {open && (
        <ul className="ops-picker-list" id="class-picker-list" role="listbox">
          <li>
            <button type="button" className="ops-picker-option" onMouseDown={() => choose(null)}>
              Every class
            </button>
          </li>
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className="ops-picker-option"
                data-active={i === active || undefined}
                role="option"
                aria-selected={c.id === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => choose(c.id)}
              >
                <span className="font-medium">{c.title}</span>
                <span className="ops-picker-meta">
                  {c.school} · {c.day}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="ops-picker-empty">Nothing matches &ldquo;{query}&rdquo;</li>
          )}
        </ul>
      )}
    </div>
  );
}

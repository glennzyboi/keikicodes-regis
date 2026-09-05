"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Campus } from "@/lib/catalogue";

/**
 * Pick your school, by typing.
 *
 * This is the one piece of their existing design that is exactly right, and it
 * is right because of how families actually arrive: a parent does not browse
 * enrichment programmes, they want to know what is on at their child's campus.
 * Their own page opens with "select a school", and so does this.
 *
 * What changed is the shape of the control. A grid of nineteen tiles is a fine
 * thing to look at once and a bad thing to use twice, and it does not scale:
 * they are adding campuses, and the tile a returning parent wants is somewhere
 * in the middle of a wall. A combobox is faster for the person who knows the
 * answer, and still browsable for the one who does not, because the whole list
 * is there the moment it opens.
 *
 * Three details that matter more than they look:
 *
 * **The logos are in the list.** Hawaii school names are long and several of
 * them start the same way; the crest is what a parent recognises before they
 * have finished reading. They are our own copies rather than the Airtable URLs
 * their site uses, which are signed and expire: the ones captured at lunchtime
 * were returning 410 by the evening.
 *
 * **Matching ignores the ʻokina and diacritics.** Somebody typing "hanahauoli"
 * on a phone keyboard must find "Hanahau‘oli School", and somebody typing
 * "waialae" must find "Wai‘alae". A search that only matches the pretty
 * spelling is a search that fails for exactly the families it is for.
 *
 * **It is a real combobox, not a div with a list under it.** Arrows move,
 * Enter chooses, Escape closes, the active option is announced, and the whole
 * thing works from the keyboard. It also works with JavaScript off, because it
 * is wrapped in a form that GETs to the same place.
 */

/** Fold ʻokina, apostrophes and accents away so typing plainly still matches. */
function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ʻ‘’'`]/g, "")
    .toLowerCase();
}

export function SchoolPicker({
  campuses,
  label = "Which school does your child go to?",
  placeholder = "Start typing a school name",
  autoFocus = false,
}: {
  campuses: Campus[];
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputId = useId();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();

  const folded = useMemo(
    () => campuses.map((c) => ({ campus: c, hay: fold(`${c.name} ${c.area ?? ""}`) })),
    [campuses],
  );

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return campuses;
    // Names that start with what was typed come first: somebody typing "ka" is
    // far more likely to want Kaimuki than a school with "ka" in the middle.
    const hits = folded.filter((f) => f.hay.includes(q));
    return hits
      .sort((a, b) => {
        const aStarts = fold(a.campus.name).startsWith(q) ? 0 : 1;
        const bStarts = fold(b.campus.name).startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.campus.name.localeCompare(b.campus.name);
      })
      .map((f) => f.campus);
  }, [campuses, folded, query]);

  // Clamped when the list shrinks under the cursor, otherwise Enter selects
  // nothing after a keystroke narrows the results.
  const active = matches.length === 0 ? -1 : Math.min(cursor, matches.length - 1);

  const choose = useCallback(
    (campus: Campus) => {
      setOpen(false);
      router.push(`/schools/${campus.slug}`);
    },
    [router],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((c) => {
        const next = (active + step + matches.length) % Math.max(matches.length, 1);
        return Number.isFinite(next) ? next : c;
      });
      return;
    }
    if (e.key === "Enter") {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      if (!open) return;
      e.preventDefault();
      setCursor(e.key === "Home" ? 0 : matches.length - 1);
    }
  }

  return (
    <div className="kc-combo" ref={boxRef}>
      <label htmlFor={inputId} className="kc-combo-label">
        {label}
      </label>

      <div className="kc-combo-shell">
        <SearchIcon />
        <input
          id={inputId}
          type="text"
          className="kc-combo-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
            // Open while there is something to narrow. Clearing the field back
            // to empty closes it rather than leaving all nineteen hanging over
            // whatever is underneath.
            setOpen(e.target.value.trim().length > 0);
          }}
          // Deliberately NOT onFocus. Opening on focus meant that on the
          // register page, where this field is the first thing on the card, the
          // full nineteen campus list unfurled over the numbered steps below it
          // before the parent had typed anything, and popped the phone keyboard
          // on page load. The list is an answer to a question; it should appear
          // once somebody has started asking.
          //
          // Click still opens, because a click is a deliberate "show me the
          // options". That handler also covers the case where the field already
          // holds focus, which fires no focus event at all.
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="kc-combo-clear"
            aria-label="Clear"
            onClick={() => {
              setQuery("");
              setCursor(0);
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul className="kc-combo-list" id={listId} role="listbox" aria-label="Schools" ref={listRef}>
          {matches.length === 0 ? (
            <li className="kc-combo-empty" role="presentation">
              No school matches &ldquo;{query}&rdquo;. We run at {campuses.length} schools this
              term and are always adding more, so email{" "}
              <a className="kc-link" href="mailto:hello@keikicoders.com">
                hello@keikicoders.com
              </a>{" "}
              to ask about yours.
            </li>
          ) : (
            matches.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="kc-combo-option"
                data-active={i === active}
                // Down rather than click, so the blur that closes the list
                // cannot beat the selection to it.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                onPointerMove={() => setCursor(i)}
              >
                <span className="kc-combo-logo">
                  {c.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="kc-combo-initial">{c.name.charAt(0)}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="kc-combo-name">{c.name}</span>
                  <span className="kc-combo-meta">
                    {c.offerings} {c.offerings === 1 ? "program" : "programs"}
                    {c.area ? ` · ${c.area}` : ""}
                  </span>
                </span>
                <span className="kc-combo-seats">
                  {c.allExternal
                    ? "Via the school"
                    : c.seatsLeft === 0
                      ? "Full"
                      : `${c.seatsLeft} seats`}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="kc-combo-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

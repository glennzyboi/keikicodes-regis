"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

/**
 * The search box, which used to be a picture of a search box.
 *
 * It was a div with the words "Search families, classes, orders" and a fake
 * command-K badge, which is worse than having nothing: it tells somebody a
 * feature exists and then does not do it. Either wire it or delete it, and this
 * is the one thing an ops console gets asked for most, so it is wired.
 *
 * Deliberately not animated. This is a thing somebody opens dozens of times a
 * day while a parent is on the phone, and at that frequency any entrance
 * animation is just a delay between the keystroke and being able to type. The
 * only motion is the row highlight, which is feedback rather than decoration.
 *
 * Keyboard first for the same reason: command-K to open, arrows to move, enter
 * to go, escape to leave. The mouse works too, but the hand is already on the
 * keyboard.
 *
 * Rendered through a portal onto the body, which is not a style choice. The
 * topbar it lives in has a backdrop-filter, and any element with one becomes
 * the containing block for position: fixed inside it. Without the portal the
 * dialog was clipped to the height of the header: it was in the DOM, it had
 * results in it, and it was two pixels tall.
 */

type Hit = {
  kind: "family" | "child" | "class" | "campus";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const ICON = {
  family: "users",
  child: "child",
  class: "book",
  campus: "grid",
} as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setCursor(0);
  }, []);

  /** Clearing lives with the typing, not in an effect reacting to it. */
  const type = useCallback((next: string) => {
    setQ(next);
    if (next.trim().length < 2) {
      setHits([]);
      setLoading(false);
    }
  }, []);

  // Command-K, or Control-K away from a Mac. Also "/" when nothing else has
  // focus, which is the habit anybody who uses a terminal already has.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);

      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced, and every in flight request is abandoned when a newer one
  // starts, so results cannot arrive out of order and overwrite each other.
  useEffect(() => {
    if (q.trim().length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/admin/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setHits(body.hits ?? []);
        setCursor(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 140);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);

  const go = useCallback(
    (hit: Hit) => {
      close();
      router.push(hit.href);
    },
    [router, close],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]);
    }
  }

  return (
    <>
      <button className="ops-search" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="search" size={14} />
        <span>Search families, classes, campuses</span>
        <kbd className="ops-kbd">Ctrl K</kbd>
      </button>

      {/* open only ever becomes true from a user event, so by the time this
          renders there is certainly a document to portal into. */}
      {open &&
        createPortal(
          <div
            className="ops-palette-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="ops-palette">
              <div className="ops-palette-input">
              <Icon name="search" size={15} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => type(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="A family, a child, a class, a campus"
                aria-label="Search"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="ops-kbd">Esc</kbd>
            </div>

            <div className="ops-palette-results">
              {q.trim().length < 2 ? (
                <p className="ops-palette-hint">
                  Type at least two characters. Arrows to move, enter to open.
                </p>
              ) : loading && hits.length === 0 ? (
                <p className="ops-palette-hint">Looking...</p>
              ) : hits.length === 0 ? (
                <p className="ops-palette-hint">
                  Nothing matches &ldquo;{q}&rdquo;. Families and children are only here once
                  they have registered.
                </p>
              ) : (
                <ul>
                  {hits.map((hit, i) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        className="ops-palette-hit"
                        data-active={i === cursor}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => go(hit)}
                      >
                        <Icon name={ICON[hit.kind]} size={15} />
                        <span className="min-w-0">
                          <span className="ops-palette-title">{hit.title}</span>
                          <span className="ops-palette-sub">{hit.subtitle}</span>
                        </span>
                        <span className="ops-pill ops-pill-quiet">{hit.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

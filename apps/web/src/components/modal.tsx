"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A dialog, shared by the console and the parent site.
 *
 * It exists because of a real layout failure. The schedule editor's forms
 * started life inside the table cell of the row they acted on, which is fine
 * for two buttons and falls apart the moment anything longer appears: a reason
 * picker, a note field and a refusal sentence all inside a `<td>` stretched the
 * row to five times its height and dragged every other column out of
 * alignment. A table is for reading, so anything you type belongs on top of it
 * rather than inside it.
 *
 * Portalled onto the body rather than rendered in place, and that is not a
 * style choice. Both headers here have a `backdrop-filter`, and any element
 * with one becomes the containing block for `position: fixed` inside it, so a
 * dialog rendered in the tree ends up clipped to whatever contains it. This
 * codebase has already paid for that lesson once, with a command palette that
 * was two pixels tall.
 *
 * Host agnostic, like the calendar and the disclosure card next to it: it reads
 * --mdl-* variables and each side sets them, so the console gets its neutral
 * greys and the parent site gets Keiki green without two implementations
 * drifting apart.
 *
 * The rest is the accessibility a dialog owes:
 *
 *   - `role="dialog"` and `aria-modal`, labelled by its own heading
 *   - focus moves in on open and returns to the button that opened it on close
 *   - Tab is trapped, so it cannot wander into the page behind
 *   - Escape closes, and so does the backdrop
 *   - the page behind does not scroll
 *
 * The entrance is 180ms, ease-out, from scale(0.97): short enough not to be a
 * delay on a screen staff use all day, and never from scale(0), because nothing
 * in the real world appears out of nothing.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  width = 620,
  tone,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  /**
   * Which palette to wear. The dialog is portalled onto the body, so it lands
   * outside both .ops and .kc-site and cannot inherit either one's tokens; the
   * host has to say. Defaults to the parent site's brand, and the console asks
   * for its own neutral greys.
   */
  tone?: "ops";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const descriptionId = useId();

  // Portals cannot be created during the server render, and rendering one on
  // the first client pass would not match the HTML that arrived.
  //
  // useSyncExternalStore rather than a setState in an effect: it returns the
  // server snapshot during SSR and the client one afterwards, which is exactly
  // this question, without the extra render pass that a state flip costs.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The first field, not the dialog, so somebody can start typing. Falls back
    // to the panel itself for a dialog that is only a question and two buttons.
    const focusable = panel.current?.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable?.[0] ?? panel.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Recomputed on every Tab rather than captured once, because a panel
      // whose fields appear and disappear (a move that reveals its time
      // inputs) would otherwise trap focus against a stale list.
      const items = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      returnTo.current?.focus?.();
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={tone === "ops" ? "mdl-backdrop mdl-ops" : "mdl-backdrop"}
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the dialog and ends
        // on the backdrop should not close it, which is what selecting text in
        // a note field looks like to a click handler.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="mdl-panel"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="mdl-head">
          <div className="min-w-0">
            <h3 id={headingId} className="mdl-title">
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="mdl-description">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="mdl-close" onClick={onClose} aria-label="Close">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mdl-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

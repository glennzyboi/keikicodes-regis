"use client";

import { useId, useState } from "react";

/**
 * Expandable rows and cards.
 *
 * Every list in this app had the same problem: the summary is what you scan and
 * the detail is what you need once you have found the right one, and putting
 * both in the table makes a wall. Putting the detail on another page makes a
 * round trip for something you wanted to glance at.
 *
 * Two rules this follows that most disclosure widgets get wrong:
 *
 *   1. The whole summary row is the control, and it is a real <button>, so it
 *      works from the keyboard and announces its state. A chevron that is the
 *      only click target is a tiny target on a phone.
 *   2. The panel is present in the DOM only when open. Rendering it hidden
 *      means a table with fifty rows renders fifty detail panels nobody asked
 *      for, and screen readers have to be told to ignore them.
 *
 * Animation is a transition on grid-template-rows, which is the one technique
 * that animates to intrinsic height without measuring anything in JavaScript.
 */
export function ExpandableRow({
  summary,
  detail,
  columns,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  detail: React.ReactNode;
  /** Column count, so the detail panel spans the whole table row. */
  columns: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <>
      <tr className="exp-row" data-open={open}>
        <td colSpan={columns} className="exp-summary-cell">
          <button
            type="button"
            className="exp-summary"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="exp-chevron" aria-hidden data-open={open}>
              <Chevron />
            </span>
            <span className="exp-summary-body">{summary}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={columns} className="exp-detail-cell">
            <div id={id} className="exp-detail">
              {detail}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The same idea for a card rather than a table row. */
export function ExpandableCard({
  summary,
  detail,
  defaultOpen = false,
  className = "",
}: {
  summary: React.ReactNode;
  detail: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={`exp-card ${className}`} data-open={open}>
      <button
        type="button"
        className="exp-card-summary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="exp-card-body">{summary}</span>
        <span className="exp-chevron" aria-hidden data-open={open}>
          <Chevron />
        </span>
      </button>

      <div className="exp-panel" data-open={open}>
        <div className="exp-panel-inner">
          <div id={id} className="exp-card-detail">
            {detail}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A labelled fact, for the inside of a detail panel. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="exp-fact">
      <dt className="exp-fact-label">{label}</dt>
      <dd className="exp-fact-value">{children}</dd>
    </div>
  );
}

export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="exp-facts">{children}</dl>;
}

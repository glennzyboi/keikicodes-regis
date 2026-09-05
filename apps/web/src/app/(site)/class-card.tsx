import Link from "next/link";
import { artFor, ProgramMark } from "./program-art";
import { GRADE_LABELS } from "@/lib/grades";
import type { Offering } from "@/lib/catalogue";

/**
 * A class, as a card in a grid.
 *
 * This used to be a disclosure that expanded in place, which had two problems
 * and both were structural rather than cosmetic. The cards were all different
 * heights, because their descriptions are, so the grid was ragged before
 * anybody touched it; and opening one reflowed every card below it, which on a
 * campus page with nine classes moves the thing you were reading.
 *
 * So: **every card is the same height, the summary is what you decide on, and
 * the detail has its own page.** Title, grades, when, how long, how much, and
 * whether there is room. Nothing else. A page rather than a modal for the
 * detail because a class is a thing parents send each other, and a link that
 * opens the right class is worth more than an animation.
 *
 * **The Register button is on the card**, not behind a click, because for a
 * parent who already knows which class they want, making them open a detail
 * page first is a step that exists only to show them more marketing.
 *
 * The card is a link and the button is a second link on top of it. That is the
 * "nested interactive" problem, solved the way it should be: the card is not an
 * anchor wrapping everything, it is a positioned shell with a stretched
 * pseudo-element from the title link, and the button sits above it on z-index.
 * A screen reader gets two clearly named links, not a link inside a link.
 *
 * A class the campus enrols itself gets no Register button at all. Fifteen of
 * their twenty-eight are like that, and sending a family to a payment page for
 * one would be taking money for something we do not run.
 */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

export function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

export function gradeChip(cls: Offering) {
  if (cls.gradeLabel) return `Grades ${cls.gradeLabel}`;
  if (cls.gradeMin === null && cls.gradeMax === null) return null;
  const lo = GRADE_LABELS[cls.gradeMin ?? 0];
  const hi = GRADE_LABELS[cls.gradeMax ?? 12];
  return lo === hi ? `Grade ${lo}` : `Grades ${lo} to ${hi}`;
}

export function ClassCard({ cls, showCampus = true }: { cls: Offering; showCampus?: boolean }) {
  const art = artFor(cls.subject ?? cls.title);
  const external = cls.registrationMode === "external";
  const left = cls.seatsLeft;
  const full = !external && left <= 0;
  const low = !external && !full && left <= 3;
  const grades = gradeChip(cls);

  return (
    <div className="kc-tile-shell">
      <article
        className="kc-tile"
        style={
          {
            "--kc-accent": art.accent,
            "--kc-soft": art.soft,
            "--kc-ink": art.ink,
          } as React.CSSProperties
        }
      >
        <div className="kc-tile-top">
          <span className="kc-program-mark">
            <ProgramMark subject={cls.subject ?? cls.title} />
          </span>
          <span className="kc-tile-badge flex flex-col items-end gap-1">
            {cls.track && <span className="kc-chip kc-chip-accent">{cls.track}</span>}
            {external ? (
              <span className="kc-chip">Via the school</span>
            ) : full ? (
              <span className="kc-chip">Full</span>
            ) : (
              <span className={`kc-chip ${low ? "kc-chip-warn" : ""}`}>
                {left === 1 ? "1 seat left" : `${left} seats left`}
              </span>
            )}
          </span>
        </div>

        <div className="kc-tile-body">
          {showCampus && (
            <span className="block font-display text-xs font-semibold uppercase tracking-wider text-green-600">
              {cls.school}
            </span>
          )}

          {/* The link that covers the card. Its accessible name is the class,
              so "Code Heroes: Virtual Reality, link" is what gets announced,
              not "card". */}
          <Link href={`/programs/${cls.id}`} className="kc-tile-link kc-tile-title">
            {cls.title}
          </Link>

          <p className="kc-tile-summary">
            {cls.description ?? "Coding, robotics and creative tech, on your child's own campus."}
          </p>

          <div className="kc-tile-facts">
            {grades && <span className="kc-chip">{grades}</span>}
            <span className="kc-chip">
              {SHORT[cls.weekday]} {timeLabel(cls.startTime)}
            </span>
            <span className="kc-chip">{cls.sessionCount} sessions</span>
          </div>
        </div>

        <div className="kc-tile-foot">
          {external ? (
            <span className="text-sm text-ink-soft">Enrolled through {cls.school}</span>
          ) : cls.priceCents !== null ? (
            <span className="kc-tile-price">
              {money(cls.priceCents)}
              <small>per child, once</small>
            </span>
          ) : (
            <span className="text-sm text-ink-soft">Price to be confirmed</span>
          )}

          <span className="kc-tile-cta">
            {external ? (
              cls.externalUrl ? (
                <a
                  href={cls.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kc-btn kc-btn-quiet text-sm"
                >
                  Go to the school
                </a>
              ) : (
                <Link href={`/programs/${cls.id}`} className="kc-btn kc-btn-quiet text-sm">
                  Details
                </Link>
              )
            ) : full ? (
              <Link href={`/programs/${cls.id}`} className="kc-btn kc-btn-quiet text-sm">
                Details
              </Link>
            ) : (
              <Link href={`/register/${cls.id}`} className="kc-btn kc-btn-primary text-sm">
                Register
              </Link>
            )}
          </span>
        </div>
      </article>
    </div>
  );
}

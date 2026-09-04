"use client";

import Link from "next/link";
import { ExpandableCard, Facts, Fact } from "@/components/expandable";
import { artFor, ProgramMark } from "./program-art";
import type { Offering } from "@/lib/catalogue";

/**
 * A class card that opens.
 *
 * The summary carries what a parent decides on: which program, which grades,
 * when, how much, and whether there is room. Everything else, the run of dates,
 * the holidays, what the term actually covers, is one tap away instead of
 * turning a campus page into a wall of text.
 *
 * Two things here are corrections rather than decoration.
 *
 * The length is the number of sessions that will really run, holidays already
 * removed. Their own catalogue does this correctly and ours used to say "10
 * weeks" from a column that stopped being true the moment a holiday existed.
 *
 * A class the campus enrols itself does not get a Register button. Fifteen of
 * their twenty-eight are like that, and sending a family to a payment page for
 * one would be taking money for something we do not run. It gets a link to the
 * school instead, saying so.
 */

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

function dayLabel(iso: string | null) {
  if (!iso) return "To be confirmed";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function ClassCard({ cls, showCampus = true }: { cls: Offering; showCampus?: boolean }) {
  const art = artFor(cls.subject ?? cls.title);
  const external = cls.registrationMode === "external";
  const left = cls.seatsLeft;
  const full = !external && left <= 0;
  const low = !external && !full && left <= 3;
  const filled = cls.capacity > 0 ? Math.round((cls.seatsTaken / cls.capacity) * 100) : 0;

  return (
    <ExpandableCard
      className="kc-program"
      summary={
        <span
          style={
            {
              "--kc-accent": art.accent,
              "--kc-soft": art.soft,
              "--kc-ink": art.ink,
            } as React.CSSProperties
          }
        >
          <span className="flex items-start justify-between gap-3">
            <span className="kc-program-mark">
              <ProgramMark subject={cls.subject ?? cls.title} />
            </span>
            {cls.track && <span className="kc-chip kc-chip-accent">{cls.track}</span>}
          </span>

          {showCampus && (
            <span className="mt-4 block font-display text-xs font-semibold uppercase tracking-wider text-green-600">
              {cls.school}
            </span>
          )}
          <span className={`${showCampus ? "mt-1" : "mt-4"} block font-display text-2xl font-bold leading-tight text-green-900`}>
            {cls.title}
          </span>
          {cls.description && (
            <span className="mt-2 line-clamp-3 block text-sm leading-relaxed text-ink-soft">
              {cls.description}
            </span>
          )}

          <span className="mt-4 flex flex-wrap gap-1.5">
            {cls.gradeLabel && <span className="kc-chip">Grades {cls.gradeLabel}</span>}
            <span className="kc-chip">
              {SHORT[cls.weekday]} {timeLabel(cls.startTime)}
            </span>
            <span className="kc-chip">{cls.sessionCount} sessions</span>
          </span>

          <span className="mt-5 block">
            {external ? (
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-sm font-semibold text-ink-soft">
                  Enrolled through the school
                </span>
                <span className="text-sm text-ink-soft">See {cls.school}</span>
              </span>
            ) : (
              <>
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={`font-display text-sm font-semibold ${
                      full ? "text-ink-soft" : low ? "text-sun-deep" : "text-green-600"
                    }`}
                  >
                    {full ? "Class is full" : left === 1 ? "1 seat left" : `${left} seats left`}
                  </span>
                  {cls.priceCents !== null && (
                    <span className="font-display text-xl font-bold text-green-900">
                      {money(cls.priceCents)}
                    </span>
                  )}
                </span>
                <span
                  className="kc-seats mt-2 block"
                  data-low={low}
                  role="img"
                  aria-label={`${filled} percent full`}
                >
                  <span style={{ width: `${Math.min(filled, 100)}%` }} />
                </span>
              </>
            )}
          </span>
        </span>
      }
      detail={
        <>
          <Facts>
            <Fact label="Campus">{cls.school}</Fact>
            {cls.location && cls.location !== cls.school && (
              <Fact label="Where">{cls.location}</Fact>
            )}
            <Fact label="Every">
              {DAYS[cls.weekday]} {timeLabel(cls.startTime)} to {timeLabel(cls.endTime)}
            </Fact>
            <Fact label="Runs">
              {dayLabel(cls.firstSession)} to {dayLabel(cls.lastSession)}
            </Fact>
            <Fact label="Length">
              {cls.sessionCount} sessions
              {cls.cancelledCount > 0 && `, with ${cls.cancelledCount} holiday${cls.cancelledCount === 1 ? "" : "s"} already taken out`}
            </Fact>
            {cls.gradeLabel && <Fact label="Grades">{cls.gradeLabel}</Fact>}
            {!external && cls.priceCents !== null && (
              <Fact label="Price">{money(cls.priceCents)} per child, paid once</Fact>
            )}
            {!external && (
              <Fact label="Class size">
                {cls.capacity} places, {left} still free
              </Fact>
            )}
            <Fact label="Term">{cls.term}</Fact>
          </Facts>

          {cls.specialNotes && (
            <p className="mt-4 rounded-lg bg-sun-soft/60 px-4 py-3 text-sm leading-relaxed text-ink">
              {cls.specialNotes}
            </p>
          )}

          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            {external
              ? `${cls.school} runs enrolment for this class themselves. We teach it, they take the registration, so their office is the place to sign up and to ask about places.`
              : "Held on your child's own campus straight after school, so there is no second pickup to arrange. Everything is supplied and there is nothing to bring."}
          </p>

          <div className="mt-5 flex justify-end">
            {external ? (
              cls.externalUrl ? (
                <a
                  href={cls.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kc-btn kc-btn-quiet text-sm"
                >
                  Register at {cls.school}
                </a>
              ) : (
                <span className="text-sm text-ink-soft">Contact the school to register</span>
              )
            ) : full ? (
              <button className="kc-btn kc-btn-quiet text-sm" disabled>
                Class is full
              </button>
            ) : (
              <Link href={`/register/${cls.id}`} className="kc-btn kc-btn-primary text-sm">
                Register for {cls.title}
              </Link>
            )}
          </div>
        </>
      }
    />
  );
}

"use client";

import Link from "next/link";
import { ExpandableCard, Facts, Fact } from "@/components/expandable";
import { artFor, ProgramMark } from "./program-art";

/**
 * A class card that opens.
 *
 * The summary carries what a parent decides on: which program, which campus,
 * when, how much, and whether there is room. Everything else, the full run of
 * dates, the age range, what a term actually covers, is one tap away instead of
 * making six cards into a wall of text.
 */

export type PublicClass = {
  id: string;
  title: string;
  summary: string;
  school: string;
  weekday: number;
  startTime: string;
  endTime: string;
  weeks: number;
  capacity: number;
  seatsTaken: number;
  priceCents: number;
  firstSession: string;
  lastSession: string | null;
  timezone: string;
};

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

/** "Ages 6 to 9" out of the summary, so it can be a chip. */
function ageChip(summary: string) {
  const match = summary.match(/Ages? ([0-9]+)(?:\s*(?:to|and up|\+|-)\s*([0-9]+)?)?/i);
  if (!match) return null;
  return match[2] ? `Ages ${match[1]} to ${match[2]}` : `Ages ${match[1]}+`;
}

export function ClassCard({ cls }: { cls: PublicClass }) {
  const art = artFor(cls.title);
  const left = cls.capacity - cls.seatsTaken;
  const full = left <= 0;
  const low = !full && left <= 3;
  const filled = Math.round((cls.seatsTaken / cls.capacity) * 100);
  const age = ageChip(cls.summary);

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
              <ProgramMark title={cls.title} />
            </span>
            <span className="kc-chip kc-chip-accent">{art.tag}</span>
          </span>

          <span className="mt-4 block font-display text-xs font-semibold uppercase tracking-wider text-green-600">
            {cls.school}
          </span>
          <span className="mt-1 block font-display text-2xl font-bold text-green-900">
            {cls.title}
          </span>
          <span className="mt-2 block text-sm leading-relaxed text-ink-soft">{cls.summary}</span>

          <span className="mt-4 flex flex-wrap gap-1.5">
            {age && <span className="kc-chip">{age}</span>}
            <span className="kc-chip">
              {SHORT[cls.weekday]} {timeLabel(cls.startTime)}
            </span>
            <span className="kc-chip">{cls.weeks} weeks</span>
          </span>

          <span className="mt-5 block">
            <span className="flex items-baseline justify-between gap-3">
              <span
                className={`font-display text-sm font-semibold ${
                  full ? "text-ink-soft" : low ? "text-sun-deep" : "text-green-600"
                }`}
              >
                {full ? "Class is full" : left === 1 ? "1 seat left" : `${left} seats left`}
              </span>
              <span className="font-display text-xl font-bold text-green-900">
                {money(cls.priceCents)}
              </span>
            </span>
            <span
              className="kc-seats mt-2 block"
              data-low={low}
              role="img"
              aria-label={`${filled} percent full`}
            >
              <span style={{ width: `${Math.min(filled, 100)}%` }} />
            </span>
          </span>
        </span>
      }
      detail={
        <>
          <Facts>
            <Fact label="Campus">{cls.school}</Fact>
            <Fact label="Every">
              {DAYS[cls.weekday]} {timeLabel(cls.startTime)} to {timeLabel(cls.endTime)}
            </Fact>
            <Fact label="Runs">
              {dayLabel(cls.firstSession)} to {dayLabel(cls.lastSession)}
            </Fact>
            <Fact label="Length">{cls.weeks} weekly sessions</Fact>
            <Fact label="Price">{money(cls.priceCents)} per child, paid once</Fact>
            <Fact label="Class size">
              {cls.capacity} places, {left} still free
            </Fact>
          </Facts>

          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Held on your child&apos;s own campus straight after school, so there is no
            second pickup to arrange. Everything is supplied and there is nothing to bring.
          </p>

          <div className="mt-5 flex justify-end">
            {full ? (
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

"use client";

import { useState } from "react";

/**
 * A month calendar, shared by the office console and the parent portal.
 *
 * Written rather than installed. A calendar library brings a date library, a
 * locale bundle and a styling opinion, for a grid that is six rows of seven
 * cells. The only genuinely fiddly part is timezones, and that is solved by
 * never constructing a local Date from a stored instant: every day key is
 * produced by Intl in the school's timezone, so a class at 3pm in Honolulu
 * lands on the Honolulu Tuesday no matter where the browser is.
 *
 * Responsive by changing shape rather than by shrinking. Below the breakpoint
 * a month grid with seven columns is unusable on a phone, so it becomes a
 * vertical agenda of the days that actually have something on them.
 */

export type CalendarEvent = {
  id: string;
  /** The instant, ISO. Never a local date string. */
  startsAt: string;
  endsAt?: string;
  title: string;
  subtitle?: string;
  /** IANA zone the event belongs to, so the day is computed correctly. */
  timezone: string;
  tone?: "default" | "cancelled" | "moved" | "muted";
  accent?: string;
  href?: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The event's day, in its own timezone, as YYYY-MM-DD. */
function dayKey(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(":00", "");
}

function keyOf(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function Calendar({
  events,
  initialMonth,
  todayKey,
  emptyLabel = "Nothing scheduled",
}: {
  events: CalendarEvent[];
  /** ISO day the calendar opens on. Defaults to the first event, else today. */
  initialMonth?: string;
  /** Today, in the viewer's relevant timezone, computed on the server so the
   *  first render matches and there is no hydration mismatch. */
  todayKey: string;
  emptyLabel?: string;
}) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = dayKey(e.startsAt, e.timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(e);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  const opening = initialMonth ?? [...byDay.keys()].sort()[0] ?? todayKey;
  const [year, setYear] = useState(Number(opening.slice(0, 4)));
  const [month, setMonth] = useState(Number(opening.slice(5, 7)) - 1);

  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const cells = Math.ceil((leading + daysInMonth) / 7) * 7;

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(first);

  function shift(by: number) {
    const next = new Date(Date.UTC(year, month + by, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  }

  // The agenda fallback: every day in this month that has something on it.
  const monthDays = [...byDay.entries()]
    .filter(([k]) => k.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="cal-nav"
            aria-label="Previous month"
          >
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="cal-nav"
            aria-label="Next month"
          >
            <Chevron dir="right" />
          </button>
        </div>

        <p className="cal-month">{monthLabel}</p>

        <button
          type="button"
          onClick={() => {
            setYear(Number(todayKey.slice(0, 4)));
            setMonth(Number(todayKey.slice(5, 7)) - 1);
          }}
          className="cal-nav cal-nav-wide"
        >
          Today
        </button>
      </div>

      {/* Month grid, from the small breakpoint up. */}
      <div className="cal-grid-wrap">
        <div className="cal-head">
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal-head-cell">
              <span aria-hidden>{d[0]}</span>
              <span className="sr-only">{d}</span>
              <span className="cal-head-long">{d.slice(1)}</span>
            </div>
          ))}
        </div>

        <div className="cal-grid">
          {Array.from({ length: cells }, (_, i) => {
            const dayNumber = i - leading + 1;
            const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
            const key = inMonth ? keyOf(year, month, dayNumber) : `pad-${i}`;
            const dayEvents = inMonth ? (byDay.get(key) ?? []) : [];

            return (
              <div
                key={key}
                className="cal-cell"
                data-outside={!inMonth}
                data-today={key === todayKey}
              >
                {inMonth && (
                  <>
                    <span className="cal-daynum">{dayNumber}</span>
                    <div className="cal-events">
                      {dayEvents.map((e) => (
                        <EventChip key={e.id} event={e} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda, below the breakpoint. Seven columns on a phone is unreadable. */}
      <div className="cal-agenda">
        {monthDays.length === 0 ? (
          <p className="cal-empty">{emptyLabel} in {monthLabel}.</p>
        ) : (
          monthDays.map(([key, list]) => (
            <div key={key} className="cal-agenda-day">
              <p className="cal-agenda-date">{agendaLabel(key)}</p>
              <div className="cal-agenda-events">
                {list.map((e) => (
                  <EventChip key={e.id} event={e} expanded />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EventChip({ event, expanded }: { event: CalendarEvent; expanded?: boolean }) {
  const content = (
    <>
      <span className="cal-event-time">{timeLabel(event.startsAt, event.timezone)}</span>
      <span className="cal-event-title">{event.title}</span>
      {expanded && event.subtitle && (
        <span className="cal-event-sub">{event.subtitle}</span>
      )}
    </>
  );

  const className = "cal-event";
  const style = event.accent ? ({ "--cal-accent": event.accent } as React.CSSProperties) : undefined;

  if (event.href) {
    return (
      <a href={event.href} className={className} data-tone={event.tone ?? "default"} style={style}>
        {content}
      </a>
    );
  }

  return (
    <span className={className} data-tone={event.tone ?? "default"} style={style}>
      {content}
    </span>
  );
}

function agendaLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "left" ? <path d="m15 5-7 7 7 7" /> : <path d="m9 5 7 7-7 7" />}
    </svg>
  );
}

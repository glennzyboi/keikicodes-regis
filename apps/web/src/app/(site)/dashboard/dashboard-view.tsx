"use client";

import { useMemo, useState } from "react";
import { Calendar, type CalendarEvent } from "@/components/calendar";
import { ExpandableCard, Facts, Fact } from "@/components/expandable";
import { CancelButton } from "./cancel-button";
import { DropButton } from "./drop-button";

/**
 * A parent's registrations, as a calendar and as cards.
 *
 * Two views because there are two questions. "What is on this week" is a
 * calendar question, and it is the one a parent asks most, especially with two
 * children in different classes on different campuses. "What exactly did I sign
 * Kaimana up for and what did it cost" is a card question.
 *
 * The child filter is the piece that makes the calendar usable for a family
 * with more than one. Filtering is client side because the whole dataset is one
 * family's term, which is tens of rows, and a round trip to hide two of them
 * would be slower than the interaction it replaces.
 */

export type DashboardRegistration = {
  enrollmentId: string;
  status: string;
  childId: string;
  childName: string;
  title: string;
  school: string;
  timezone: string;
  scheduleLabel: string;
  priceCents: number;
  paid: boolean;
  sessionsLeft: number;
  sessionsTotal: number;
  accent: string;
  sessions: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    note: string | null;
    seq: number;
  }[];
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function DashboardView({
  registrations,
  todayKey,
}: {
  registrations: DashboardRegistration[];
  todayKey: string;
}) {
  const children = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of registrations) seen.set(r.childId, r.childName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [registrations]);

  const [childFilter, setChildFilter] = useState<string>("all");
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const visible =
    childFilter === "all"
      ? registrations
      : registrations.filter((r) => r.childId === childFilter);

  const live = visible.filter((r) => r.status !== "cancelled" && r.status !== "dropped");
  const cancelled = visible.filter((r) => r.status === "cancelled");
  const dropped = visible.filter((r) => r.status === "dropped");

  const events: CalendarEvent[] = live.flatMap((r) =>
    r.sessions.map((s) => ({
      id: `${r.enrollmentId}-${s.id}`,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      title: r.title,
      subtitle: `${r.childName} · ${r.school}${s.note ? ` · ${s.note}` : ""}`,
      timezone: r.timezone,
      tone:
        s.status === "cancelled"
          ? ("cancelled" as const)
          : s.status === "rescheduled"
            ? ("moved" as const)
            : ("default" as const),
      accent: r.accent,
    })),
  );

  return (
    <div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        {children.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by child">
            <button
              className="kc-btn kc-btn-quiet text-sm"
              data-chosen={childFilter === "all"}
              onClick={() => setChildFilter("all")}
            >
              Everyone
            </button>
            {children.map((c) => (
              <button
                key={c.id}
                className="kc-btn kc-btn-quiet text-sm"
                data-chosen={childFilter === c.id}
                onClick={() => setChildFilter(c.id)}
              >
                {c.name.split(" ")[0]}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex gap-2" role="group" aria-label="View">
          <button
            className="kc-btn kc-btn-quiet text-sm"
            data-chosen={view === "calendar"}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
          <button
            className="kc-btn kc-btn-quiet text-sm"
            data-chosen={view === "list"}
            onClick={() => setView("list")}
          >
            My classes
          </button>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="kc-card mt-5 p-5">
          {events.length === 0 ? (
            <p className="py-8 text-center text-ink-soft">
              Nothing scheduled for {childFilter === "all" ? "your keiki" : "them"} yet.
            </p>
          ) : (
            <Calendar events={events} todayKey={todayKey} emptyLabel="No classes" />
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {live.map((r) => (
            <ExpandableCard
              key={r.enrollmentId}
              summary={
                <span>
                  <span className="block font-display text-xs font-semibold uppercase tracking-wider text-green-600">
                    {r.school}
                  </span>
                  <span className="mt-1 block font-display text-xl font-bold text-green-900">
                    {r.title}
                  </span>
                  <span className="mt-1 block text-sm text-ink-soft">
                    {r.childName} · {r.scheduleLabel}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="kc-chip">{money(r.priceCents)}</span>
                    <span className="kc-chip">{r.sessionsLeft} of {r.sessionsTotal} left</span>
                    {r.status === "cancellation_requested" ? (
                      <span className="kc-chip kc-chip-accent">Cancellation requested</span>
                    ) : (
                      <span className="kc-chip kc-chip-accent">Enrolled</span>
                    )}
                  </span>
                </span>
              }
              detail={
                <>
                  <Facts>
                    <Fact label="Child">{r.childName}</Fact>
                    <Fact label="Campus">{r.school}</Fact>
                    <Fact label="When">{r.scheduleLabel}</Fact>
                    <Fact label="Paid">{r.paid ? money(r.priceCents) : "Awaiting payment"}</Fact>
                    <Fact label="Sessions">
                      {r.sessionsLeft} still to run, out of {r.sessionsTotal}
                    </Fact>
                  </Facts>

                  <p className="mt-5 font-display text-sm font-semibold text-green-900">
                    Every date
                  </p>
                  <ul className="mt-2 space-y-1">
                    {r.sessions.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline py-1.5 text-sm last:border-b-0"
                      >
                        <span className={s.status === "cancelled" ? "line-through opacity-60" : ""}>
                          {new Intl.DateTimeFormat("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: r.timezone,
                          }).format(new Date(s.startsAt))}
                        </span>
                        <span className="text-ink-soft">
                          {s.status === "cancelled"
                            ? (s.note ?? "Cancelled")
                            : s.status === "rescheduled"
                              ? "Moved"
                              : `Session ${s.seq}`}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {r.status === "cancellation_requested" ? (
                    <p className="mt-4 rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900">
                      We have your request and the office will be in touch about the
                      refund. The seat stays yours until they confirm.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {/* Both text-sm. These sit side by side in one row, and
                          every other button on this page is text-sm, so a
                          smaller one next to a larger one reads as a mistake
                          rather than as emphasis. */}
                      <CancelButton
                        enrollmentId={r.enrollmentId}
                        child={r.childName}
                        className="kc-btn kc-btn-quiet text-sm"
                      />
                      <DropButton
                        enrollmentId={r.enrollmentId}
                        child={r.childName}
                        className="kc-btn kc-btn-quiet text-sm"
                      />
                    </div>
                  )}
                </>
              }
            />
          ))}

          {dropped.length > 0 && (
            <>
              <h2 className="mt-10 font-display text-xl font-bold text-green-900">Dropped</h2>
              <div className="mt-3 space-y-2">
                {dropped.map((r) => (
                  <div
                    key={r.enrollmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-paper px-5 py-4 text-sm"
                  >
                    <span>
                      <span className="font-medium">{r.childName}</span> in {r.title}
                    </span>
                    <span className="kc-chip">Dropped</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {cancelled.length > 0 && (
            <>
              <h2 className="mt-10 font-display text-xl font-bold text-green-900">Cancelled</h2>
              <div className="mt-3 space-y-2">
                {cancelled.map((r) => (
                  <div
                    key={r.enrollmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-paper px-5 py-4 text-sm"
                  >
                    <span>
                      <span className="font-medium">{r.childName}</span> in {r.title}
                    </span>
                    <span className="text-ink-soft">Cancelled</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

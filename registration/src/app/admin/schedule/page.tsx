import Link from "next/link";
import { readAsStaff, sessionRows } from "../queries";
import { EmptyState, PageHead, Pill } from "../ui";

export const dynamic = "force-dynamic";

/**
 * Everything happening next, across every campus.
 *
 * Grouped by day rather than listed flat, because the question is almost always
 * "what is on this week" and never "show me session 7 of everything". Cancelled
 * and moved dates stay visible, since a date that used to exist is exactly what
 * someone is ringing about.
 */
export default async function Schedule() {
  const { data: sessions } = await readAsStaff((tx) => sessionRows(tx, { upcomingOnly: true }));

  type Row = (typeof sessions)[number];
  const byDay = new Map<string, Row[]>();
  for (const s of sessions) {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(s.starts_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s);
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="Schedule"
        note="Every session from today onwards, in each campus's own timezone. Cancelled and moved dates stay on the list, because those are the ones parents ring about."
      />

      {sessions.length === 0 ? (
        <section className="ops-panel ops-enter">
          <EmptyState icon="calendar" title="Nothing scheduled" note="No upcoming sessions." />
        </section>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, rows]) => (
            <section key={day} className="ops-panel ops-enter">
              <div className="ops-panel-head">
                <div>
                  <h2 className="text-[15px] font-semibold">{dayLabel(day)}</h2>
                  <p className="mt-0.5 text-[var(--ops-muted)]">
                    {rows.length} session{rows.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div>
                {rows.map((s) => (
                  <div key={s.session_id} className="ops-row">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/classes/${s.class_offering_id}`}
                        className="font-medium underline decoration-transparent underline-offset-2 hover:decoration-inherit"
                      >
                        {s.title}
                      </Link>
                      <p className="ops-mono">
                        {s.school} · session {s.seq} · {s.enrolled} enrolled
                      </p>
                      {s.note && (
                        <p className="mt-1 text-[var(--ops-muted)]">{s.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="ops-mono">
                        {new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: s.timezone,
                        }).format(new Date(s.starts_at))}
                      </span>
                      {s.status === "scheduled" && <Pill tone="good">on</Pill>}
                      {s.status === "cancelled" && <Pill tone="danger">cancelled</Pill>}
                      {s.status === "rescheduled" && <Pill tone="quiet">moved</Pill>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

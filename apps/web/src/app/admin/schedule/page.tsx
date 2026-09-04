import { readAsStaff, sessionRows } from "../queries";
import { EmptyState, PageHead, Pill } from "../ui";
import { Calendar, type CalendarEvent } from "@/components/calendar";

export const dynamic = "force-dynamic";

/**
 * Every session, as a month calendar.
 *
 * A list answered "what is next" and nothing else. A calendar answers the
 * question staff actually have, which is what a week looks like, where the gaps
 * are, and whether cancelling Tuesday leaves the campus empty.
 *
 * Cancelled and moved dates stay on the grid, struck through rather than
 * removed. A date that used to exist is exactly what someone is ringing about,
 * and a calendar that quietly forgets it cannot answer them.
 */
export default async function Schedule() {
  const { data: sessions } = await readAsStaff((tx) => sessionRows(tx, {}));

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.session_id,
    startsAt: new Date(s.starts_at).toISOString(),
    endsAt: new Date(s.ends_at).toISOString(),
    title: s.title,
    subtitle: `${s.school} · ${s.enrolled} enrolled${s.note ? ` · ${s.note}` : ""}`,
    timezone: s.timezone,
    tone:
      s.status === "cancelled" ? "cancelled" : s.status === "rescheduled" ? "moved" : "default",
    href: `/admin/classes/${s.class_offering_id}`,
  }));

  // Today in Honolulu, computed on the server so the first render matches the
  // client and there is no hydration mismatch on the highlighted cell.
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const cancelled = sessions.filter((s) => s.status === "cancelled").length;
  const moved = sessions.filter((s) => s.status === "rescheduled").length;
  const upcoming = sessions.filter(
    (s) => s.status === "scheduled" && new Date(s.starts_at) >= new Date(),
  ).length;

  return (
    <div className="space-y-4">
      <PageHead
        title="Schedule"
        note="Every session across every campus, in each campus's own timezone. Cancelled and moved dates stay on the calendar, because those are the ones parents ring about."
      />

      <div className="flex flex-wrap gap-2">
        <Pill tone="good">{upcoming} still to run</Pill>
        {cancelled > 0 && <Pill tone="danger">{cancelled} cancelled</Pill>}
        {moved > 0 && <Pill tone="quiet">{moved} moved</Pill>}
      </div>

      <section className="ops-panel ops-enter p-4">
        {sessions.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing scheduled" note="No sessions exist yet." />
        ) : (
          <Calendar events={events} todayKey={todayKey} emptyLabel="No classes" />
        )}
      </section>
    </div>
  );
}

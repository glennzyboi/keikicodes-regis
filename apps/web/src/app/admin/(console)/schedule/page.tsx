import { readAsStaff, sessionRows, classRows } from "@/app/admin/queries";
import { EmptyState, PageHead, Pill } from "@/app/admin/ui";
import { FilterBar } from "@/app/admin/filters";
import { ClassPicker } from "@/app/admin/class-picker";
import { Calendar, type CalendarEvent } from "@/components/calendar";

export const dynamic = "force-dynamic";

/**
 * Every session, as a month calendar, with filters.
 *
 * A list answered "what is next" and nothing else. A calendar answers the
 * question staff actually have, which is what a week looks like, where the gaps
 * are, and whether cancelling Tuesday leaves the campus empty.
 *
 * The filters are the part that was missing, and the reason is arithmetic: the
 * real catalogue is 28 classes across 15 campuses and about 400 sessions, so an
 * unfiltered month is nine or ten chips in a single cell and answers nothing at
 * all. Somebody opening this page has one campus, or one class, or one question
 * ("what did we cancel?") in mind.
 *
 * They are query parameters rather than component state on purpose. A filtered
 * calendar is then a link: "the Wednesday closures at Waikiki" can be pasted
 * into a message and open the same view for whoever receives it, the back
 * button works, and the whole control needs no client JavaScript.
 *
 * Cancelled and moved dates stay on the grid by default, struck through rather
 * than removed. A date that used to exist is exactly what someone is ringing
 * about, and a calendar that quietly forgets it cannot answer them. Turning
 * them off is a filter, not the default.
 */
export default async function Schedule({
  searchParams,
}: {
  searchParams: Promise<{ school?: string; class?: string; status?: string }>;
}) {
  const params = await searchParams;

  // Whitelisted before it reaches SQL. The column has a CHECK constraint on
  // these three values, so anything else would be a query that raises rather
  // than one that returns nothing.
  const status =
    params.status === "scheduled" ||
    params.status === "cancelled" ||
    params.status === "rescheduled"
      ? params.status
      : undefined;

  const { data } = await readAsStaff(async (tx) => ({
    sessions: await sessionRows(tx, {
      schoolId: params.school,
      status,
      limit: 600,
    }),
    classes: await classRows(tx),
  }));

  // The filter lists are built from what is actually on the calendar rather
  // than from every school on file, so the dropdown never offers a campus that
  // would produce an empty month.
  const schools = [...new Map(data.classes.map((c) => [c.school_id, c.school])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const classesAtSchool = params.school
    ? data.classes.filter((c) => c.school_id === params.school)
    : data.classes;

  const filtered = params.class
    ? data.sessions.filter((s) => s.class_offering_id === params.class)
    : data.sessions;

  const events: CalendarEvent[] = filtered.map((s) => ({
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

  const cancelled = filtered.filter((s) => s.status === "cancelled").length;
  const moved = filtered.filter((s) => s.status === "rescheduled").length;
  const upcoming = filtered.filter(
    (s) => s.status === "scheduled" && new Date(s.starts_at) >= new Date(),
  ).length;

  const filtering = Boolean(params.school || params.class || status);

  return (
    <div className="space-y-4">
      <PageHead
        title="Schedule"
        note="Every session across every campus, in each campus's own timezone. Cancelled and moved dates stay on the calendar, because those are the ones parents ring about."
      />

      {/*
        The same filter bar as everywhere else, so a campus dropdown behaves
        identically on the calendar and on the class list. It used to be a GET
        form with an Apply button, which is one click too many on something
        people fiddle with, and it was the last place in the console that still
        worked that way.
      */}
      <FilterBar
        basePath="/admin/schedule"
        selects={[
          {
            name: "school",
            label: "Campus",
            value: params.school,
            anyLabel: "Every campus",
            options: schools.map((s) => ({ value: s.id, label: s.name })),
          },
          {
            name: "status",
            label: "Showing",
            value: status,
            anyLabel: "Everything",
            options: [
              { value: "scheduled", label: "Running only" },
              { value: "cancelled", label: "Cancelled only" },
              { value: "rescheduled", label: "Moved only" },
            ],
          },
        ]}
      >
        {/*
          The class filter is a combobox, not a dropdown.

          A select is fine for eight options and useless for four hundred: no
          way to search it, and the same curriculum appears under one title at
          five campuses, so what you want looks identical to four things you do
          not. Type any part of the title, the campus or the day instead.
        */}
        <ClassPicker
          basePath="/admin/schedule"
          value={params.class}
          classes={classesAtSchool.map((c) => ({
            id: c.id,
            title: c.title,
            school: c.school,
            day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][c.weekday],
          }))}
        />
      </FilterBar>

      {/*
        How many the filter produced.

        This went missing when the GET form became the filter bar, and it should
        not have: a month grid does not let you count, so "412 sessions shown"
        against "38 sessions shown" is the only thing that tells you the campus
        filter did anything at all on a busy month.
      */}
      <div className="ops-counts flex flex-wrap items-center gap-2">
        <span className="text-[var(--ops-muted)]">
          {filtered.length} {filtered.length === 1 ? "session" : "sessions"} shown
        </span>
        <Pill tone="good">{upcoming} still to run</Pill>
        {cancelled > 0 && <Pill tone="danger">{cancelled} cancelled</Pill>}
        {moved > 0 && <Pill tone="quiet">{moved} moved</Pill>}
      </div>

      <section className="ops-panel ops-enter p-4">
        {filtered.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={filtering ? "Nothing matches those filters" : "Nothing scheduled"}
            note={
              filtering
                ? "Try a different campus, or clear the filters."
                : "No sessions exist yet."
            }
          />
        ) : (
          <Calendar events={events} todayKey={todayKey} emptyLabel="No classes" />
        )}
      </section>
    </div>
  );
}

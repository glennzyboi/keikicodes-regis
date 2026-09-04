import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@keiki/core/db";
import { currentParent } from "@/lib/parent-auth";
import { artFor } from "../program-art";
import { PortalView, type PortalRegistration } from "./portal-view";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

type Row = {
  enrollment_id: string;
  status: string;
  child_id: string;
  child_name: string;
  class_offering_id: string;
  title: string;
  school: string;
  timezone: string;
  weekday: number;
  start_time: string;
  end_time: string;
  weeks: number;
  price_cents: number;
  paid_at: Date | null;
};

export default async function Portal() {
  // No token, no link, no shared credential. Signed in or not here.
  const parent = await currentParent();
  if (!parent) redirect("/login?next=%2Fportal");

  const rows = await sql<Row[]>`
    select e.id as enrollment_id, e.status,
           ch.id as child_id, ch.first_name || ' ' || ch.last_name as child_name,
           c.id as class_offering_id, c.title, s.name as school, s.timezone,
           c.weekday, c.start_time, c.end_time, c.weeks,
           oi.unit_price_cents as price_cents, o.fulfilled_at as paid_at
      from enrollments e
      join children ch          on ch.id = e.child_id
      join class_offerings c    on c.id = e.class_offering_id
      join schools s            on s.id = c.school_id
      join order_items oi       on oi.id = e.order_item_id
      join orders o             on o.id = oi.order_id
     where ch.parent_id = ${parent.id}
     order by e.status, c.weekday, ch.first_name`;

  // Sessions for every class this family is in, fetched once rather than per
  // registration, so a family with four places is still one query.
  const classIds = [...new Set(rows.map((r) => r.class_offering_id))];
  const sessions = classIds.length
    ? await sql<
        {
          id: string;
          class_offering_id: string;
          starts_at: Date;
          ends_at: Date;
          status: string;
          note: string | null;
          seq: number;
        }[]
      >`select id, class_offering_id, starts_at, ends_at, status, note, seq
          from sessions
         where class_offering_id = any(${classIds})
         order by starts_at`
    : [];

  const now = new Date();

  const registrations: PortalRegistration[] = rows.map((r) => {
    const mine = sessions.filter((s) => s.class_offering_id === r.class_offering_id);
    return {
      enrollmentId: r.enrollment_id,
      status: r.status,
      childId: r.child_id,
      childName: r.child_name,
      title: r.title,
      school: r.school,
      timezone: r.timezone,
      scheduleLabel: `${DAYS[r.weekday]} ${timeLabel(r.start_time)} to ${timeLabel(r.end_time)}`,
      priceCents: r.price_cents,
      paid: Boolean(r.paid_at),
      weeks: r.weeks,
      sessionsLeft: mine.filter((s) => s.status === "scheduled" && s.starts_at >= now).length,
      accent: artFor(r.title).accent,
      sessions: mine.map((s) => ({
        id: s.id,
        startsAt: new Date(s.starts_at).toISOString(),
        endsAt: new Date(s.ends_at).toISOString(),
        status: s.status,
        note: s.note,
        seq: s.seq,
      })),
    };
  });

  // Today in the school timezone, computed on the server so the highlighted
  // cell matches on first render and there is no hydration mismatch.
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <span className="kc-eyebrow">My registrations</span>
      <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-green-900">
        Aloha, {parent.fullName.split(" ")[0]}
      </h1>
      <p className="mt-3 text-ink-soft">Everything registered to {parent.email}.</p>

      {registrations.length === 0 ? (
        <div className="kc-card mt-10 p-8 text-center">
          <p className="font-display text-lg font-semibold text-green-900">
            Nothing registered yet
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            When you register, it will show up here with the full term calendar.
          </p>
          <Link href="/" className="kc-btn kc-btn-primary mt-6">
            Browse classes
          </Link>
        </div>
      ) : (
        <PortalView registrations={registrations} todayKey={todayKey} />
      )}
    </div>
  );
}

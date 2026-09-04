import Link from "next/link";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/stripe";
import { redirect } from "next/navigation";
import { currentParent } from "@/lib/parent-auth";
import { CancelButton } from "./cancel-button";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Rendered in the school's timezone, never the viewer's. A parent in Honolulu
 * and a grandparent in Manila must read the same class time.
 */
function sessionLabel(startsAt: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(startsAt);
}

type Row = {
  enrollment_id: string;
  status: string;
  refund_owed: boolean;
  child: string;
  title: string;
  school: string;
  timezone: string;
  weekday: number;
  start_time: string;
  end_time: string;
  weeks: number;
  price_cents: number;
  order_id: string;
  paid_at: Date | null;
  next_session: Date | null;
  sessions_left: number;
};

export default async function Portal() {
  // No token, no link, no shared credential. Signed in or not here.
  const parent = await currentParent();
  if (!parent) redirect("/login?next=%2Fportal");

  const parentId = parent.id;

  const rows = await sql<Row[]>`
    select e.id as enrollment_id, e.status, e.refund_owed,
           ch.first_name || ' ' || ch.last_name as child,
           c.title, s.name as school, s.timezone,
           c.weekday, c.start_time, c.end_time, c.weeks, c.price_cents,
           o.id as order_id, o.fulfilled_at as paid_at,
           (select min(ses.starts_at) from sessions ses
             where ses.class_offering_id = c.id
               and ses.status = 'scheduled' and ses.starts_at >= now()) as next_session,
           (select count(*)::int from sessions ses
             where ses.class_offering_id = c.id
               and ses.status = 'scheduled' and ses.starts_at >= now()) as sessions_left
      from enrollments e
      join children ch          on ch.id = e.child_id
      join class_offerings c    on c.id = e.class_offering_id
      join schools s            on s.id = c.school_id
      join order_items oi       on oi.id = e.order_item_id
      join orders o             on o.id = oi.order_id
     where ch.parent_id = ${parentId}
     order by e.status, c.weekday, ch.first_name`;

  const live = rows.filter((r) => r.status !== "cancelled");
  const past = rows.filter((r) => r.status === "cancelled");

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <span className="kc-eyebrow">My registrations</span>
      <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-green-900">
        Aloha, {parent.fullName.split(" ")[0]}
      </h1>
      <p className="mt-3 text-ink-soft">
        Everything registered to {parent.email}.
      </p>

      {live.length === 0 && (
        <div className="kc-card mt-10 p-8 text-center">
          <p className="font-display text-lg font-semibold text-green-900">
            Nothing registered yet
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            When you register, it will show up here.
          </p>
          <Link href="/" className="kc-btn kc-btn-primary mt-6">
            Browse classes
          </Link>
        </div>
      )}

      <div className="kc-stagger mt-10 space-y-4">
        {live.map((r) => (
          <article key={r.enrollment_id} className="kc-card kc-enter p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
                  {r.school}
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold text-green-900">
                  {r.title}
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {r.child}, {DAYS[r.weekday]} {timeLabel(r.start_time)} to{" "}
                  {timeLabel(r.end_time)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-bold text-green-900">
                  {formatMoney(r.price_cents)}
                </p>
                <p className="text-xs text-ink-soft">
                  {r.paid_at ? "Paid" : "Awaiting payment"}
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-3 border-t border-hairline pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-soft">Next class</dt>
                <dd className="mt-0.5 font-medium">
                  {r.next_session
                    ? sessionLabel(new Date(r.next_session), r.timezone)
                    : "Term finished"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Sessions left</dt>
                <dd className="mt-0.5 font-medium">
                  {r.sessions_left} of {r.weeks}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Status</dt>
                <dd className="mt-0.5 font-medium">
                  {r.status === "cancellation_requested" ? (
                    <span className="text-sun-deep">Cancellation requested</span>
                  ) : (
                    <span className="text-green-600">Enrolled</span>
                  )}
                </dd>
              </div>
            </dl>

            {r.status === "cancellation_requested" ? (
              <p className="mt-4 rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900">
                We have your request and the office will be in touch about the refund. The
                seat stays yours until they confirm, so nobody else can take it while this
                is being sorted out.
              </p>
            ) : (
              <div className="mt-4 flex justify-end">
                <CancelButton enrollmentId={r.enrollment_id} child={r.child} />
              </div>
            )}
          </article>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h2 className="mt-12 font-display text-xl font-bold text-green-900">Cancelled</h2>
          <div className="mt-4 space-y-3">
            {past.map((r) => (
              <div
                key={r.enrollment_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-paper px-5 py-4 text-sm"
              >
                <span>
                  <span className="font-medium">{r.child}</span> in {r.title}
                </span>
                <span className="text-ink-soft">
                  {r.refund_owed ? "Refund being processed" : "Cancelled"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

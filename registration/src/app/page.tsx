import Link from "next/link";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

export default async function Home() {
  const classes = await sql<
    {
      id: string;
      title: string;
      summary: string;
      school: string;
      weekday: number;
      start_time: string;
      end_time: string;
      weeks: number;
      capacity: number;
      seats_taken: number;
      price_cents: number;
      first_session_date: string;
    }[]
  >`select c.id, c.title, c.summary, s.name as school, c.weekday, c.start_time,
           c.end_time, c.weeks, c.capacity, c.seats_taken, c.price_cents,
           c.first_session_date
      from class_offerings c
      join schools s on s.id = c.school_id
     where c.status = 'published'
     order by s.name, c.weekday`;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="max-w-3xl">
        <span className="kc-eyebrow">Fall 2026 &middot; Oahu</span>
        <h1 className="mt-5 font-display text-5xl font-bold leading-[0.95] tracking-tight text-green-900 sm:text-6xl">
          Register your keiki for{" "}
          <span className="kc-highlight">after school</span> coding
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">
          Ten weeks on your child&apos;s own campus, taught by our instructors, with everything
          supplied. Pick a class, register in about two minutes, and pay at the end.
        </p>
      </div>

      <div className="kc-stagger mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const left = c.capacity - c.seats_taken;
          const full = left <= 0;
          return (
            <article
              key={c.id}
              className="kc-card kc-card-interactive kc-enter flex flex-col p-6"
            >
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
                {c.school}
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-green-900">
                {c.title}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{c.summary}</p>

              <dl className="mt-5 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">When</dt>
                  <dd className="text-right font-medium">
                    {DAYS[c.weekday]} {timeLabel(c.start_time)} to {timeLabel(c.end_time)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Length</dt>
                  <dd className="font-medium">{c.weeks} weeks</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Price</dt>
                  <dd className="font-display font-bold text-green-900">
                    {formatMoney(c.price_cents)}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-hairline pt-4">
                <span
                  className={`font-display text-sm font-semibold ${
                    full ? "text-ink-soft" : left <= 3 ? "text-sun-deep" : "text-green-600"
                  }`}
                >
                  {full
                    ? "Class is full"
                    : left === 1
                      ? "1 seat left"
                      : `${left} seats left`}
                </span>
                {full ? (
                  <button className="kc-btn kc-btn-quiet text-sm" disabled>
                    Full
                  </button>
                ) : (
                  <Link href={`/register/${c.id}`} className="kc-btn kc-btn-primary text-sm">
                    Register
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

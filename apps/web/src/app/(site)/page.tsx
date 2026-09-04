import Link from "next/link";
import { sql } from "@keiki/core/db";
import { artFor } from "./program-art";
import { ClassCard, type PublicClass } from "./class-card";

export const dynamic = "force-dynamic";

/** Database row to the shape the card wants. Keeps SQL naming out of the UI. */
function toPublic(c: {
  id: string;
  title: string;
  summary: string;
  school: string;
  timezone: string;
  weekday: number;
  start_time: string;
  end_time: string;
  weeks: number;
  capacity: number;
  seats_taken: number;
  price_cents: number;
  first_session_date: string;
  last_session: Date | null;
}): PublicClass {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    school: c.school,
    timezone: c.timezone,
    weekday: c.weekday,
    startTime: c.start_time,
    endTime: c.end_time,
    weeks: c.weeks,
    capacity: c.capacity,
    seatsTaken: c.seats_taken,
    priceCents: c.price_cents,
    firstSession: String(c.first_session_date).slice(0, 10),
    lastSession: c.last_session ? new Date(c.last_session).toISOString().slice(0, 10) : null,
  };
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
      timezone: string;
      last_session: Date | null;
    }[]
  >`select c.id, c.title, c.summary, s.name as school, s.timezone, c.weekday,
           c.start_time, c.end_time, c.weeks, c.capacity, c.seats_taken,
           c.price_cents, c.first_session_date,
           (select max(ses.starts_at) from sessions ses
             where ses.class_offering_id = c.id and ses.status <> 'cancelled') as last_session
      from class_offerings c
      join schools s on s.id = c.school_id
     where c.status = 'published'
     order by s.name, c.weekday`;

  const campuses = [...new Set(classes.map((c) => c.school))];
  const seatsLeft = classes.reduce((s, c) => s + (c.capacity - c.seats_taken), 0);

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="kc-wash border-b border-hairline">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-3xl">
            <span className="kc-eyebrow-chip">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-full bg-green-700 text-[11px] font-bold text-white"
              >
                K
              </span>
              Fall 2026 &middot; Oahu
            </span>

            <h1 className="mt-6 font-display text-5xl font-bold leading-[0.95] tracking-tight text-green-900 sm:text-6xl">
              Register your keiki for{" "}
              <span className="kc-highlight">after school</span> coding
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
              Ten weeks on your child&apos;s own campus, taught by our instructors, with
              everything supplied. Pick a class, register in about two minutes, and pay at
              the end.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#classes" className="kc-btn kc-btn-primary">
                See this term&apos;s classes
              </a>
              <Link href="/portal" className="kc-btn kc-btn-quiet">
                Find my registration
              </Link>
            </div>
          </div>

          {/* The numbers a parent actually wants before they scroll. */}
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              [String(classes.length), "programs"],
              [String(campuses.length), "campuses"],
              ["10", "weeks a term"],
              [String(seatsLeft), "seats left"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="font-display text-3xl font-bold text-green-900">{value}</dt>
                <dd className="mt-0.5 text-sm text-ink-soft">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* --------------------------------------------------------- classes */}
      <section id="classes" className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="kc-eyebrow">This term</span>
            <h2 className="mt-4 font-display text-3xl font-bold text-green-900 sm:text-4xl">
              Six programs across{" "}
              <span className="kc-highlight">three campuses</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            Every class runs on the child&apos;s own campus straight after school, so there is
            no second pickup to arrange.
          </p>
        </div>

        <div className="kc-stagger mt-10 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <ClassCard key={c.id} cls={toPublic(c)} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="kc-band border-y border-green-200">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <span className="kc-eyebrow">How it works</span>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold text-green-900 sm:text-4xl">
            Registering takes about <span className="kc-highlight">two minutes</span>
          </h2>

          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {[
              [
                "Pick the class",
                "Choose the campus and the program. The seat count on each card is live, so what you see is what is actually left.",
              ],
              [
                "Add your keiki",
                "One form for the whole family. Add a second child and they go on the same order and the same payment.",
              ],
              [
                "Pay once",
                "Card payment through Stripe. Your seat is held while you pay, so nobody can take it out from under you.",
              ],
            ].map(([title, body], i) => (
              <div key={title}>
                <span className="kc-step-number">{i + 1}</span>
                <h3 className="mt-4 font-display text-xl font-bold text-green-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- campuses */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <span className="kc-eyebrow">Campuses</span>
        <h2 className="mt-4 font-display text-3xl font-bold text-green-900">
          On your child&apos;s own campus
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {campuses.map((school) => {
            const here = classes.filter((c) => c.school === school);
            return (
              <div key={school} className="kc-card p-6">
                <h3 className="font-display text-lg font-bold text-green-900">{school}</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  {here.length} program{here.length === 1 ? "" : "s"} this term
                </p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {here.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: artFor(c.title).accent }}
                      />
                      <span className="text-ink-soft">{c.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

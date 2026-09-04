import Link from "next/link";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/stripe";
import { artFor, ProgramMark } from "./program-art";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "Ages 6 to 9" out of the summary, so the card can show it as a chip. */
function ageChip(summary: string | null) {
  const match = summary?.match(/Ages? ([\d]+)(?:\s*(?:to|and up|\+|-)\s*([\d]+)?)?/i);
  if (!match) return null;
  return match[2] ? `Ages ${match[1]} to ${match[2]}` : `Ages ${match[1]}+`;
}

function startLabel(date: string) {
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
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

        <div className="kc-stagger mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => {
            const art = artFor(c.title);
            const left = c.capacity - c.seats_taken;
            const full = left <= 0;
            const low = !full && left <= 3;
            const filled = Math.round((c.seats_taken / c.capacity) * 100);
            const age = ageChip(c.summary);

            return (
              <article
                key={c.id}
                className="kc-program kc-enter flex flex-col"
                style={
                  {
                    "--kc-accent": art.accent,
                    "--kc-soft": art.soft,
                    "--kc-ink": art.ink,
                  } as React.CSSProperties
                }
              >
                <div className="kc-program-band" />

                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="kc-program-mark">
                      <ProgramMark title={c.title} />
                    </div>
                    <span className="kc-chip kc-chip-accent">{art.tag}</span>
                  </div>

                  <p className="mt-4 font-display text-xs font-semibold uppercase tracking-wider text-green-600">
                    {c.school}
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-green-900">
                    {c.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">
                    {c.summary}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {age && <span className="kc-chip">{age}</span>}
                    <span className="kc-chip">
                      {SHORT[c.weekday]} {timeLabel(c.start_time)}
                    </span>
                    <span className="kc-chip">{c.weeks} weeks</span>
                    <span className="kc-chip">Starts {startLabel(c.first_session_date)}</span>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`font-display text-sm font-semibold ${
                          full ? "text-ink-soft" : low ? "text-sun-deep" : "text-green-600"
                        }`}
                      >
                        {full
                          ? "Class is full"
                          : left === 1
                            ? "1 seat left"
                            : `${left} seats left`}
                      </span>
                      <span className="text-xs text-ink-soft">
                        {c.seats_taken} of {c.capacity} taken
                      </span>
                    </div>
                    <div
                      className="kc-seats mt-2"
                      data-low={low}
                      role="img"
                      aria-label={`${filled}% full`}
                    >
                      <span style={{ width: `${Math.min(filled, 100)}%` }} />
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-hairline pt-4">
                    <div>
                      <p className="font-display text-2xl font-bold text-green-900">
                        {formatMoney(c.price_cents)}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {DAYS[c.weekday]} {timeLabel(c.start_time)} to{" "}
                        {timeLabel(c.end_time)}
                      </p>
                    </div>
                    {full ? (
                      <button className="kc-btn kc-btn-quiet text-sm" disabled>
                        Full
                      </button>
                    ) : (
                      <Link
                        href={`/register/${c.id}`}
                        className="kc-btn kc-btn-primary text-sm"
                      >
                        Register
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
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

import Link from "next/link";
import { sql } from "@keiki/core/db";
import { campuses } from "@/lib/catalogue";
import { CampusPicker } from "./campus-picker";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * It used to show every class as a flat grid, which was fine for six invented
 * ones and is useless for the twenty-eight they actually run across fifteen
 * campuses. A parent arrives knowing exactly one thing, which school their
 * child goes to, so that is the first question rather than the last.
 *
 * Every number on this page is counted, not typed. The previous version said
 * "Six programs across three campuses" and "10 weeks a term" in hardcoded
 * English, which stopped being true the moment the catalogue changed and would
 * have been wrong on camera.
 */
export default async function Home() {
  const list = await campuses();

  const [totals] = await sql<
    { offerings: number; programs: number; seats_left: number; sessions: number }[]
  >`select count(*)::int                                                   as offerings,
           count(distinct c.program_id)::int                               as programs,
           coalesce(sum(greatest(c.capacity - c.seats_taken, 0)), 0)::int  as seats_left,
           (select count(*) from sessions s
             join class_offerings co on co.id = s.class_offering_id
            where s.status = 'scheduled' and co.status = 'published')::int as sessions
      from class_offerings c
     where c.status = 'published'`;

  const [term] = await sql<{ name: string }[]>`
    select name from terms where is_current order by starts_on desc limit 1`;

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
              {term?.name ?? "This term"} &middot; Oahu
            </span>

            <h1 className="mt-6 font-display text-5xl font-bold leading-[0.95] tracking-tight text-green-900 sm:text-6xl">
              Find your keiki&apos;s next{" "}
              <span className="kc-highlight">a-ha</span> moment
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
              Coding, robotics and creative tech, on your child&apos;s own campus straight
              after school. Pick your school to see what is running this term, register in
              about two minutes, and pay at the end.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#campuses" className="kc-btn kc-btn-primary">
                Pick your school
              </a>
              <Link href="/portal" className="kc-btn kc-btn-quiet">
                My registrations
              </Link>
            </div>
          </div>

          {/* Counted, every one of them. */}
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              [String(list.length), list.length === 1 ? "campus" : "campuses"],
              [String(totals?.offerings ?? 0), "classes this term"],
              [String(totals?.programs ?? 0), "programs"],
              [String(totals?.seats_left ?? 0), "seats left"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="font-display text-3xl font-bold text-green-900">{value}</dt>
                <dd className="mt-0.5 text-sm text-ink-soft">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* -------------------------------------------------------- campuses */}
      <section id="campuses" className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="kc-eyebrow">Start here</span>
            <h2 className="mt-4 font-display text-3xl font-bold text-green-900 sm:text-4xl">
              Pick your <span className="kc-highlight">school</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            Classes run on the child&apos;s own campus straight after school, so there is no
            second pickup to arrange.
          </p>
        </div>

        <div className="mt-8">
          <CampusPicker campuses={list} />
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
                "Choose your campus, then the program. The seat count on every card is live, so what you see is what is actually left.",
              ],
              [
                "Add your keiki",
                "One form for the whole family. Add a second child and they go on the same order and the same payment, not a second one.",
              ],
              [
                "Pay once",
                "Card payment through Stripe. Your seat is held while you pay, so nobody can take it out from under you.",
              ],
            ].map(([title, body], i) => (
              <div key={title}>
                <span className="kc-step-number">{i + 1}</span>
                <h3 className="mt-4 font-display text-xl font-bold text-green-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Some campuses run enrolment through their own office. Those classes are listed
            here too, marked as such, with a link straight to the school, because knowing
            where to sign up is the parent&apos;s actual problem.
          </p>
        </div>
      </section>
    </>
  );
}

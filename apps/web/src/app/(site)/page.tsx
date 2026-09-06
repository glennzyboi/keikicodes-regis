import Link from "next/link";
import { sql } from "@keiki/core/db";
import { cachedCampuses } from "@/lib/catalogue-cache";
import { HeroPrograms } from "./hero-programs";
import { WhatHappens } from "./what-happens";
import { Reveal, CountUp } from "./reveal";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * It used to be the catalogue: a school picker and a grid, with no answer to
 * "what is this?" for anybody who arrived from a flyer rather than from a
 * teacher. Browsing now has its own tab, so this page can do the job a home
 * page is for, which is to say what the thing is, who it is for, and what
 * actually happens, in about fifteen seconds.
 *
 * Every number on it is counted, not typed. The version before last said "Six
 * programs across three campuses" and "10 weeks a term" in hardcoded English,
 * which stopped being true the moment the catalogue changed and would have been
 * wrong on camera.
 *
 * The animation is doing a job rather than decorating. The hero film shows the
 * three steps of registering in the order they happen and ends on a live seat
 * count, which is the one thing this system does that a Fillout form cannot.
 * Everything below it is a scroll reveal that fires once and then stops
 * observing, and every bit of it is off entirely under `prefers-reduced-motion`.
 */
export default async function Home() {
  const campuses = await cachedCampuses();

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

  // Four real classes for the hero: published, sellable, with a picture, and
  // with seats. Ordered so the ones a parent can actually still get into come
  // first, because a hero advertising four full classes is worse than no hero.
  const featured = await sql<
    {
      id: string;
      title: string;
      school: string;
      track: string | null;
      image_url: string | null;
      weekday: number;
      start_time: string;
      seats_left: number;
    }[]
  >`
    select d.id, d.title, d.school_name as school, d.program_track as track,
           d.program_image_url as image_url, d.weekday, d.start_time::text,
           d.seats_left
      from offering_details d
     where d.status = 'published'
       and d.registration_mode = 'keiki_coders'
       and d.term_is_current
       and d.program_image_url is not null
     order by (d.seats_left > 0) desc, d.seats_left desc
     limit 4`;

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="kc-wash border-b border-hairline">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight text-green-900 sm:text-6xl">
              Find your keiki&apos;s next{" "}
              <span className="kc-highlight">a-ha</span> moment
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
              Coding, robotics and creative tech, on your child&apos;s own campus straight
              after school. No second pickup to arrange, nothing to bring, and registering
              takes about two minutes.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="kc-btn kc-btn-primary">
                Register your keiki
              </Link>
              <Link href="/programs" className="kc-btn kc-btn-quiet">
                See what is running
              </Link>
            </div>

            {/* Counted, every one of them. */}
            <dl className="mt-12 grid max-w-xl grid-cols-2 gap-6 sm:grid-cols-4">
              {[
                [campuses.length, campuses.length === 1 ? "campus" : "campuses"],
                [totals?.offerings ?? 0, "classes this term"],
                [totals?.programs ?? 0, "programs"],
                [totals?.seats_left ?? 0, "seats left"],
              ].map(([value, label]) => (
                <div key={String(label)}>
                  <dt className="font-display text-3xl font-bold text-green-900">
                    <CountUp to={Number(value)} />
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink-soft">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <HeroPrograms classes={featured} />
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="kc-band border-b border-green-200">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal>
            <span className="kc-eyebrow">How it works</span>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold text-green-900 sm:text-4xl">
              Registering takes about <span className="kc-highlight">two minutes</span>
            </h2>
          </Reveal>

          {/*
            The mascot film used to sit here, took the full width, and explained
            nothing. What belongs in the space is the part that is actually
            different from the form parents are used to: what the system does on
            its own once they press pay. See what-happens.tsx.
          */}
          <div className="mt-8">
            <WhatHappens />
          </div>

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
              <Reveal key={title} delay={i * 0.08}>
                <span className="kc-step-number">{i + 1}</span>
                <h3 className="mt-4 font-display text-xl font-bold text-green-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- programs */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <Reveal>
          <span className="kc-eyebrow">What we teach</span>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold text-green-900 sm:text-4xl">
            {totals?.programs ?? 0} programs, from{" "}
            <span className="kc-highlight">first blocks</span> to real code
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-soft">
            A curriculum runs at several campuses at once, so a child who moves school can
            carry on where they left off. Each one is pitched at a grade range rather than an
            age, which is how schools actually group children.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Explorers", "Kindergarten to grade 2", "First programs, robots that follow a plan, and a great deal of noise."],
            ["Juniors", "Grades 2 to 4", "Block coding into real logic. Loops, conditions, and games they design themselves."],
            ["Heroes", "Grades 4 to 6", "Virtual reality, animation and stop motion. Building something an adult would keep."],
            ["Masters", "Grades 6 to 8", "Text based code, hardware, and projects that run for the whole term."],
          ].map(([track, grades, body], i) => (
            <Reveal key={track} delay={i * 0.06}>
              <div className="kc-card h-full p-6">
                <span className="kc-chip kc-chip-accent">{track}</span>
                <p className="mt-4 font-display text-sm font-semibold uppercase tracking-wide text-green-600">
                  {grades}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/programs" className="kc-btn kc-btn-primary">
              Browse every class
            </Link>
            <p className="text-sm text-ink-soft">
              {totals?.sessions ?? 0} sessions scheduled across {campuses.length} campuses this
              term.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ----------------------------------------------------------- honest */}
      <section className="kc-band border-y border-green-200">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal>
            <span className="kc-eyebrow">Before you sign up</span>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold text-green-900 sm:text-4xl">
              Two things worth knowing
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Reveal>
              <div className="kc-card h-full p-6">
                <h3 className="font-display text-xl font-bold text-green-900">
                  Some schools enroll their own
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  At several campuses the school office takes the registration rather than us.
                  Those classes are listed here too, marked as such, with a link straight to
                  the school, because knowing where to sign up is the actual problem.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="kc-card h-full p-6">
                <h3 className="font-display text-xl font-bold text-green-900">
                  Holidays are already taken out
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  The session count on every class is what will really run, with school
                  breaks and closures removed. Every date is listed on the class page, so
                  there is no arithmetic to do.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- last */}
      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <Reveal>
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold text-green-900 sm:text-4xl">
            {totals?.seats_left ?? 0} seats are still free this term
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink-soft">
            Start with the school your child goes to. If you have more than one, they go on
            the same form and the same payment.
          </p>
          <Link href="/register" className="kc-btn kc-btn-primary mt-8">
            Register your keiki
          </Link>
        </Reveal>
      </section>
    </>
  );
}

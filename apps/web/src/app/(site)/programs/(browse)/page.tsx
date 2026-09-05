import Link from "next/link";
import { cachedCampuses } from "@/lib/catalogue-cache";
import { SchoolPicker } from "../../school-picker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Programs — Keiki Coders",
  description:
    "Coding, robotics and creative tech on your child's own campus, across Oahu. Find what is running at your school this term.",
};

/**
 * Browse the catalogue.
 *
 * Separate from Register on purpose. Browsing is undirected: a parent wants to
 * see what exists, compare two classes, and read what "Code Heroes" means
 * before committing to anything. Registering is directed and ends in a form.
 * Putting both behind one tab called "Programs" meant somebody who knew exactly
 * what they wanted still had to scroll a marketing page, and somebody who was
 * only looking found themselves in a checkout.
 *
 * It still opens with the school, because that is the only thing a parent
 * arrives knowing, and it is the one part of their own design that is exactly
 * right. What changed is that the list of nineteen campuses is a combobox
 * rather than a wall of tiles, so the parent who knows the answer types four
 * letters and the one who does not still sees everything.
 */
export default async function Programs() {
  const campuses = await cachedCampuses();

  const totals = campuses.reduce(
    (acc, c) => ({
      offerings: acc.offerings + c.offerings,
      seats: acc.seats + c.seatsLeft,
      external: acc.external + (c.allExternal ? 1 : 0),
    }),
    { offerings: 0, seats: 0, external: 0 },
  );

  const byArea = new Map<string, typeof campuses>();
  for (const c of campuses) {
    const key = c.area ?? "Across Oahu";
    byArea.set(key, [...(byArea.get(key) ?? []), c]);
  }
  const areas = [...byArea.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <section className="kc-wash border-b border-hairline">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
          <span className="kc-eyebrow">Programs</span>
          <h1 className="mt-4 max-w-2xl font-display text-4xl font-bold leading-tight text-green-900 sm:text-5xl">
            Find what is running at{" "}
            <span className="kc-highlight">your school</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
            {totals.offerings} classes across {campuses.length} campuses this term. Classes run
            on your child&apos;s own campus straight after school, so there is no second pickup
            to arrange.
          </p>

          <div className="mt-8 max-w-xl">
            <SchoolPicker campuses={campuses} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12">
        <h2 className="font-display text-2xl font-bold text-green-900">
          Every campus, by area
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Some campuses run enrollment through their own office. Those are listed here too,
          marked as such, with a link straight to the school, because knowing where to sign
          up is the parent&apos;s actual problem.
        </p>

        <div className="mt-8 space-y-10">
          {areas.map(([area, list]) => (
            <div key={area}>
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-green-600">
                {area}
              </h3>
              <ul className="kc-stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((c) => (
                  <li key={c.id}>
                    <Link href={`/schools/${c.slug}`} className="kc-campus group">
                      <span className="kc-campus-logo">
                        {c.logoUrl ? (
                          // Our own copy. Theirs are signed Airtable URLs that
                          // expire, and the ones captured at lunchtime were
                          // returning 410 by the evening.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.logoUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="kc-campus-initial">{c.name.charAt(0)}</span>
                        )}
                      </span>
                      <span className="kc-campus-name">{c.name}</span>
                      <span className="kc-campus-meta">
                        {c.offerings} {c.offerings === 1 ? "program" : "programs"}
                      </span>
                      <span className="kc-campus-seats">
                        {c.allExternal
                          ? "Enrolled through the school"
                          : c.seatsLeft === 0
                            ? "Full for this term"
                            : `${c.seatsLeft} seats left`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

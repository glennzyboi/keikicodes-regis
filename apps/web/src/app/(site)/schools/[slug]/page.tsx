import Link from "next/link";
import { notFound } from "next/navigation";
import { offeringsAtSchool, schoolBySlug } from "@/lib/catalogue";
import { CampusClasses } from "./campus-classes";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const school = await schoolBySlug(slug);
  return {
    title: school ? `${school.name} — Keiki Coders` : "Keiki Coders",
  };
}

/**
 * One campus, and everything running there.
 *
 * The grade filter is the addition that matters. Their form shows a parent
 * every class at the school and lets them choose one their child is not
 * eligible for; nothing finds out until somebody reads the roster. Here the
 * parent says which grade their child is in and the list answers honestly,
 * including saying how many it just hid, so a filter never silently swallows
 * the thing they came for.
 */
export default async function CampusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const school = await schoolBySlug(slug);
  if (!school) notFound();

  const offerings = await offeringsAtSchool(slug);
  const external = offerings.filter((o) => o.registrationMode === "external").length;
  const seats = offerings
    .filter((o) => o.registrationMode === "keiki_coders")
    .reduce((n, o) => n + o.seatsLeft, 0);

  return (
    <>
      <section className="kc-wash border-b border-hairline">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
          <Link href="/" className="kc-back">
            <span aria-hidden>&larr;</span> All schools
          </Link>

          <div className="mt-5 flex flex-wrap items-center gap-5">
            {school.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={school.logoUrl}
                alt=""
                className="h-16 max-w-[140px] object-contain"
                loading="lazy"
              />
            )}
            <div>
              <h1 className="font-display text-4xl font-bold leading-tight text-green-900">
                {school.name}
              </h1>
              <p className="mt-1 text-sm text-ink-soft">
                {offerings.length} {offerings.length === 1 ? "program" : "programs"} this term
                {school.area ? ` · ${school.area}` : ""}
                {school.kind ? ` · ${school.kind} school` : ""}
              </p>
            </div>
          </div>

          {offerings.length > 0 && (
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-soft">
              {external === offerings.length
                ? `${school.name} takes registrations for these classes through their own office. We teach them; they enroll for them.`
                : external > 0
                  ? `${offerings.length - external} of these register here. The other ${external} go through the school's own office, and each one says so and links straight there.`
                  : `${seats} seats still free across this campus.`}
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        {offerings.length === 0 ? (
          <div className="kc-card px-6 py-10 text-center">
            <h2 className="font-display text-2xl font-bold text-green-900">
              Nothing running here this term
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
              We are not at {school.name} this term. Email{" "}
              <a className="kc-link" href="mailto:hello@keikicoders.com">
                hello@keikicoders.com
              </a>{" "}
              and we will tell you as soon as that changes.
            </p>
            <Link href="/" className="kc-btn kc-btn-quiet mt-6 text-sm">
              See other schools
            </Link>
          </div>
        ) : (
          <CampusClasses offerings={offerings} />
        )}
      </section>
    </>
  );
}

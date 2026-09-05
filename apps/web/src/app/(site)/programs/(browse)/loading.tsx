import { Bar, HeadingSkeleton } from "@/components/skeleton";

/*
 * Why this sits in a route group.
 *
 * `loading.tsx` applies to a segment and everything under it, so putting one
 * at `programs/` wrapped `programs/[id]` in a Suspense boundary too. That
 * starts the response streaming, and once a response is streaming its HTTP
 * status has already been sent, so `notFound()` on a class that does not exist
 * arrived as a 200 instead of a 404.
 *
 * The group keeps the skeleton on the landing page, where nothing can 404, and
 * off the id route, where a real 404 matters more than a shimmer. The URL is
 * unchanged: a route group is invisible to routing.
 *
 * Caught by an existing abuse test asserting 404 on a well formed id that does
 * not exist, which is exactly the sort of thing a skeleton silently breaks.
 */

export default function Loading() {
  return (
    <>
      <section className="kc-wash border-b border-hairline">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
          <HeadingSkeleton />
          <Bar w="100%" h={54} className="mt-8 max-w-xl rounded-2xl" />
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-5 py-12" aria-hidden>
        <Bar w={280} h={26} />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Bar key={i} h={172} className="rounded-2xl" />
          ))}
        </div>
      </section>
    </>
  );
}

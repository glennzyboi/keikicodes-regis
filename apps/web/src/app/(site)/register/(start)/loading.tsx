import { Bar, HeadingSkeleton } from "@/components/skeleton";

/*
 * Why this sits in a route group.
 *
 * `loading.tsx` applies to a segment and everything under it, so putting one
 * at `register/` wrapped `register/[id]` in a Suspense boundary too. That
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
    <section className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
      <span className="sr-only" role="status">
        Loading
      </span>
      <HeadingSkeleton />
      <Bar h={300} className="mt-10 rounded-3xl" />
    </section>
  );
}

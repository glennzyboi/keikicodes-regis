import Link from "next/link";

/**
 * The "that is not here" page, as a component rather than a route.
 *
 * Shared by two callers that cannot be the same file. `not-found.tsx` is what
 * Next renders when a page calls `notFound()`, and `link-gone/page.tsx` is
 * what the proxy rewrites a malformed URL to so it can carry a real 404
 * status. One copy of the words, two ways in.
 */
export function NotFoundView() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <span className="kc-eyebrow">Not found</span>
      <h1 className="mt-5 font-display text-4xl font-bold text-green-900">
        That class is <span className="kc-highlight">not here</span>
      </h1>
      <p className="mt-4 text-ink-soft">
        The link may be from a past term, or the class may have closed. Everything running
        this term is on the programs page.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/programs" className="kc-btn kc-btn-primary">
          See this term&apos;s classes
        </Link>
        <Link href="/dashboard" className="kc-btn kc-btn-quiet">
          Find my registration
        </Link>
      </div>
    </div>
  );
}

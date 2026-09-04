import Link from "next/link";

/**
 * A class that is not there any more.
 *
 * The most likely way a parent lands here is a bookmarked or shared link to a
 * class that has since closed, so the page says that plainly and puts the
 * catalogue one click away, rather than showing them the word 404.
 */
export default function NotFound() {
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
        <Link href="/" className="kc-btn kc-btn-primary">
          See this term&apos;s classes
        </Link>
        <Link href="/portal" className="kc-btn kc-btn-quiet">
          Find my registration
        </Link>
      </div>
    </div>
  );
}

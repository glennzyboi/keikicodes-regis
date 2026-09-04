import Link from "next/link";

/** The parent facing side, in their brand. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kc-site flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-hairline bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-full bg-green-700 font-display text-lg font-bold text-white"
            >
              K
            </span>
            <span className="font-display text-xl font-bold text-green-900">
              Keiki Coders
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/" className="kc-btn kc-btn-quiet text-sm">
              Programs
            </Link>
            <Link href="/portal" className="kc-btn kc-btn-quiet text-sm">
              My registrations
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-hairline bg-green-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-3">
          <div>
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-full bg-sun font-display text-lg font-bold text-green-900"
            >
              K
            </span>
            <p className="mt-4 font-display text-lg font-bold">Keiki Coders</p>
            <p className="mt-1 text-sm text-white/70">
              After school coding across Oahu.
            </p>
          </div>
          <div className="text-sm">
            <p className="font-display font-semibold">Campuses</p>
            <ul className="mt-3 space-y-1.5 text-white/70">
              <li>Iolani School</li>
              <li>Maryknoll School</li>
              <li>Kalani High School</li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-display font-semibold">Trial build</p>
            <p className="mt-3 text-white/70">
              A demonstration registration system built for a paid trial task, not
              affiliated with Keiki Coders. Payments run in Stripe test mode and no real
              card is ever charged. Brand colours and typefaces are taken from
              keikicoders.com.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

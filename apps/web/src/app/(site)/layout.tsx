import Link from "next/link";
import Image from "next/image";
import { currentParent } from "@/lib/parent-auth";
import { signOutParent } from "./account/actions";
import { SiteNav } from "./site-nav";

export const dynamic = "force-dynamic";

/** The parent facing side, in their brand. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const parent = await currentParent();

  return (
    <div className="kc-site flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-hairline bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/icon.png"
              alt=""
              width={40}
              height={40}
              priority
              className="h-10 w-10 rounded-full object-cover"
            />
            <span className="font-display text-xl font-bold text-green-900">
              Keiki Coders
            </span>
          </Link>
          <SiteNav signedIn={Boolean(parent)} />

          <div className="flex items-center gap-2">
            {parent ? (
              <form action={signOutParent}>
                <button className="kc-btn kc-btn-quiet text-sm">Sign out</button>
              </form>
            ) : (
              <>
                <Link href="/login" className="kc-btn kc-btn-quiet text-sm">
                  Sign in
                </Link>
                <Link href="/signup" className="kc-btn kc-btn-primary text-sm">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-hairline bg-green-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-3">
          <div>
            <Image
              src="/icon.png"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 rounded-full object-cover"
            />
            <p className="mt-4 font-display text-lg font-bold">Keiki Coders</p>
            <p className="mt-1 text-sm text-white/70">
              After school coding across Oahu.
            </p>
          </div>
          <div className="text-sm">
            <p className="font-display font-semibold">Find a class</p>
            <ul className="mt-3 space-y-1.5 text-white/70">
              <li>
                <Link href="/programs" className="hover:text-white">
                  Browse by school
                </Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-white">
                  Register
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-white">
                  My family&apos;s classes
                </Link>
              </li>
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

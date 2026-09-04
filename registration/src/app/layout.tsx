import type { Metadata } from "next";
import { Fredoka, Poppins } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Their two faces, taken from the live site. Fredoka does far more than
// headlines for them: eyebrows, stat numbers and small labels are all Fredoka.
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fredoka",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Keiki Coders | Register",
  description:
    "Register your keiki for after-school coding classes across Oahu. Trial build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${poppins.variable}`}>
      <body className="min-h-screen flex flex-col">
        <header className="bg-paper border-b border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
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

        <footer className="mt-16 border-t border-hairline bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-8 text-sm text-ink-soft">
            <p className="font-display font-semibold text-green-900">
              Trial build, not affiliated with Keiki Coders
            </p>
            <p className="mt-1 max-w-2xl">
              A demonstration registration system built for a paid trial task. Payments run
              in Stripe test mode and no real card is ever charged. Brand colours and
              typefaces are taken from keikicoders.com.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

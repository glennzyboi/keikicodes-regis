import type { Metadata } from "next";
import { Fredoka, Poppins, Inter } from "next/font/google";
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

// The office runs on a different face entirely. Fredoka is a friendly display
// type built to sell a class to a parent; it is the wrong tool for a screen
// someone reads eight hours a day, where the job is density and legibility at
// 13px. See the ops layer in globals.css.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Keiki Coders | Register",
  description:
    "Register your keiki for after-school coding classes across Oahu. Trial build.",
};

/**
 * Deliberately bare.
 *
 * The parent facing pages and the office console are two different products
 * that happen to share a database, so the chrome lives in their own layouts:
 * (site) carries the brand, admin carries none of it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${poppins.variable} ${inter.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

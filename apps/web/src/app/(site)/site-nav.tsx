"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The top level navigation.
 *
 * It used to be one item, "Programs", which pointed at the home page, plus
 * "My registrations". That is a site with one destination and a sign in link,
 * and it hid the two things a visitor is actually here to do behind the same
 * word.
 *
 * The split is by task, not by content:
 *
 *   Home       what this is, who it is for, and what a term looks like
 *   Programs   browse the catalogue, campus by campus, and read about a class
 *   Register   the form, starting from "which school?"
 *   Dashboard  what my family is signed up to, and when it runs
 *
 * "Programs" and "Register" are genuinely different jobs even though they both
 * end at a class. Browsing is undirected and comparative; registering is
 * directed and has a form at the end of it. Their own site makes exactly this
 * split, /find-a-program and /register, and it is the right one.
 *
 * "Dashboard" replaces "My registrations". The old name described a list of
 * receipts; what a parent actually opens it for is "what has my child got on
 * this week", which is a calendar, so the name had to grow with the page.
 *
 * The active item is decided from the path rather than passed in, so a link
 * added here cannot forget to light up.
 */

type Item = { href: string; label: string };

const PUBLIC: Item[] = [
  { href: "/", label: "Home" },
  { href: "/programs", label: "Programs" },
  { href: "/register", label: "Register" },
];

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();

  const items: Item[] = signedIn
    ? [...PUBLIC, { href: "/dashboard", label: "Dashboard" }]
    : PUBLIC;

  return (
    <nav className="kc-nav" aria-label="Main">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="kc-nav-link"
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

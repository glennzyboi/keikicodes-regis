"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Campus } from "@/lib/catalogue";

/**
 * Pick your school first.
 *
 * This is the one piece of their existing design that is exactly right, and it
 * is right because of how families actually arrive: a parent does not browse
 * enrichment programmes, they want to know what is on at their child's campus.
 * Their own page opens with "pick your school", and so does this.
 *
 * What is better here is small and entirely about not wasting the parent's
 * time. Filtering happens as they type instead of after a round trip. Campuses
 * whose classes are all enrolled through the school say so on the tile, so
 * nobody clicks through to find they are in the wrong place. And the seat count
 * is real, which is the thing their system cannot do at all.
 */
export function CampusPicker({ campuses }: { campuses: Campus[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campuses;
    return campuses.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.area ?? "").toLowerCase().includes(q),
    );
  }, [campuses, query]);

  return (
    <>
      <div className="kc-fieldset max-w-md">
        <label htmlFor="campus-search">Search schools</label>
        <input
          id="campus-search"
          type="search"
          autoComplete="off"
          placeholder="Start typing a school name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="mt-8 rounded-xl border border-hairline bg-white px-5 py-6 text-sm text-ink-soft">
          No campus matches &ldquo;{query}&rdquo;. We run at {campuses.length} schools this
          term, and we are always adding more. Email{" "}
          <a className="kc-link" href="mailto:hello@keikicoders.com">
            hello@keikicoders.com
          </a>{" "}
          to ask about yours.
        </p>
      ) : (
        <ul className="kc-stagger mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/schools/${c.slug}`} className="kc-campus group">
                <span className="kc-campus-logo">
                  {c.logoUrl ? (
                    // Their logos are Airtable URLs that expire, so this is a
                    // best effort with a real fallback rather than a broken box.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="kc-campus-initial">{c.name.charAt(0)}</span>
                  )}
                </span>
                <span className="kc-campus-name">{c.name}</span>
                <span className="kc-campus-meta">
                  {c.offerings} {c.offerings === 1 ? "program" : "programs"}
                  {c.area ? ` · ${c.area}` : ""}
                </span>
                <span className="kc-campus-seats">
                  {c.allExternal
                    ? "Enrolled through the school"
                    : c.seatsLeft === 0
                      ? "Full for this term"
                      : `${c.seatsLeft} seats left`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

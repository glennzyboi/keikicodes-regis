"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tabs on one class.
 *
 * Real routes rather than `?tab=`, so each one gets its own skeleton while it
 * loads and each one is a link somebody can send: "the roster for Wednesday
 * Wai'alae" should open the roster, not the class with a note to click again.
 */
export function ClassTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/admin/classes/${id}`;

  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/roster`, label: "Roster" },
    { href: `${base}/schedule`, label: "Schedule" },
    { href: `${base}/money`, label: "Money" },
    { href: `${base}/edit`, label: "Edit" },
  ];

  return (
    <div className="ops-tabs" role="tablist">
      {tabs.map((t) => {
        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="ops-tab"
            data-chosen={active || undefined}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

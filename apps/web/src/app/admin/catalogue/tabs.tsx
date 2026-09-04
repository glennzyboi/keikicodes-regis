"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/catalogue/classes", label: "Classes" },
  { href: "/admin/catalogue/programs", label: "Programs" },
  { href: "/admin/catalogue/schools", label: "Campuses" },
  { href: "/admin/catalogue/terms", label: "Terms" },
  { href: "/admin/catalogue/import", label: "Import" },
];

export function CatalogueTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="ops-btn"
            data-chosen={active}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

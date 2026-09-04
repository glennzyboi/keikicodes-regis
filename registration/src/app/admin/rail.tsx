"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName, initials, tintFor } from "./ui";
import type { Counts } from "./queries";

type Item = {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  tone?: "info" | "warn" | "danger" | "quiet";
};

/**
 * The rail.
 *
 * Each section is its own route rather than an anchor into one long page. The
 * console was a single scroll and it read as a wall; splitting it means someone
 * dealing with refunds is looking at refunds and nothing else, and the badge
 * tells them whether the other queues need them yet.
 */
export function Rail({
  counts,
  staff,
}: {
  counts: Counts;
  staff: { fullName: string; email: string };
}) {
  const pathname = usePathname();

  const work: Item[] = [
    { href: "/admin", label: "Overview", icon: "grid" },
    {
      href: "/admin/payments",
      label: "Payments",
      icon: "card",
      count: counts.unconfirmed,
      tone: "danger",
    },
    {
      href: "/admin/cancellations",
      label: "Cancellations",
      icon: "undo",
      count: counts.cancellations,
      tone: "warn",
    },
    {
      href: "/admin/refunds",
      label: "Refunds",
      icon: "cash",
      count: counts.refunds,
      tone: "warn",
    },
  ];

  const capacity: Item[] = [
    { href: "/admin/holds", label: "Seat holds", icon: "clock", count: counts.holds, tone: "quiet" },
    { href: "/admin/classes", label: "Classes", icon: "book", count: counts.classes, tone: "quiet" },
  ];

  return (
    <aside className="ops-rail">
      <div className="ops-rail-brand">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-md bg-[var(--ops-rail-active)] text-[12px] font-bold text-[#08130e]"
        >
          K
        </span>
        <span className="font-semibold">Keiki Ops</span>
        <span className="ops-mono ml-auto">test</span>
      </div>

      <Group label="Needs a decision" items={work} pathname={pathname} />
      <Group label="Capacity" items={capacity} pathname={pathname} />

      <div className="ops-rail-foot">
        <div className="flex items-center gap-2.5">
          <span className="ops-avatar" style={{ background: tintFor(staff.email) }}>
            {initials(staff.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{staff.fullName}</p>
            <p className="ops-mono truncate">{staff.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Group({
  label,
  items,
  pathname,
}: {
  label: string;
  items: Item[];
  pathname: string;
}) {
  return (
    <div className="ops-rail-group">
      <p className="ops-rail-label">{label}</p>
      <div className="space-y-0.5">
        {items.map((item) => {
          // Overview is the index, so it only matches exactly. Everything else
          // stays lit while you are anywhere inside it.
          const active =
            item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className="ops-rail-link" data-active={active}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className={`ops-pill ops-pill-${item.tone ?? "quiet"} ml-auto`}>
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

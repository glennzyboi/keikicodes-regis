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
 * The rail, grouped by the job someone came here to do.
 *
 * The console started as one long page of queues, which reads as a wall. The
 * grouping is deliberate and matches how an office actually splits the day:
 *
 *   Today      things that are stuck and need a decision now
 *   People     answering the phone, which means finding a family fast
 *   Programs   the classes themselves, their rosters and their calendar
 *   Comms      what we have told families, and whether it arrived
 *
 * Badges only appear when the number is actionable. A count of how many classes
 * exist is furniture; a count of refunds that failed at Stripe is a queue.
 */
export function Rail({
  counts,
  staff,
}: {
  counts: Counts;
  staff: { fullName: string; email: string };
}) {
  const pathname = usePathname();

  // Payments, cancellations and refunds used to be three entries. They are one
  // job, the state of the money, so they are one destination with sub tabs. The
  // badge is the total of everything unresolved across all three.
  const moneyOpen = counts.unconfirmed + counts.cancellations + counts.refunds;

  const today: Item[] = [
    { href: "/admin", label: "Overview", icon: "grid" },
    {
      href: "/admin/money",
      label: "Money",
      icon: "cash",
      count: moneyOpen,
      tone: counts.unconfirmed > 0 ? "danger" : "warn",
    },
  ];

  const people: Item[] = [
    { href: "/admin/families", label: "Families", icon: "users", count: counts.families, tone: "quiet" },
    { href: "/admin/students", label: "Students", icon: "child", count: counts.students, tone: "quiet" },
  ];

  // The catalogue is what the office edits; the rest of this group is what it
  // then watches. Keeping them apart stops "add a class" and "who is in this
  // class" competing for the same tab.
  const catalogue: Item[] = [
    { href: "/admin/catalogue/classes", label: "Catalogue", icon: "book", count: counts.classes, tone: "quiet" },
  ];

  const programs: Item[] = [
    { href: "/admin/classes", label: "Rosters", icon: "users", count: counts.classes, tone: "quiet" },
    { href: "/admin/schedule", label: "Schedule", icon: "calendar" },
    { href: "/admin/holds", label: "Seat holds", icon: "clock", count: counts.holds, tone: "quiet" },
  ];

  const comms: Item[] = [
    {
      href: "/admin/notifications",
      label: "Outbox",
      icon: "mail",
      count: counts.outbox,
      tone: counts.outbox > 0 ? "warn" : "quiet",
    },
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

      <Group label="Today" items={today} pathname={pathname} />
      <Group label="People" items={people} pathname={pathname} />
      <Group label="Catalogue" items={catalogue} pathname={pathname} />
      <Group label="Programs" items={programs} pathname={pathname} />
      <Group label="Comms" items={comms} pathname={pathname} />

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
          // stays lit while you are anywhere inside it, including detail pages.
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

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
  /** Match this path exactly rather than as a prefix. */
  exact?: boolean;
};

/**
 * The rail, grouped by the job somebody came here to do.
 *
 * The grouping changed because the old one described the code rather than the
 * office. "Catalogue" and "Rosters" were two entries onto the same 28 records:
 * one to edit a class, one to see who was in it. Staff had to know which tab a
 * job lived on before they could start it, and the two lists drifted apart
 * because nothing made them agree.
 *
 * There is exactly one record this business runs on, the class offering, which
 * is a program, at a campus, in a term. So there is one destination for it, and
 * schools, programs and terms are what it points at rather than places to go
 * hunting: they are filters on the class list and rows in Setup.
 *
 *   Today      what is stuck and needs a decision now
 *   People     answering the phone, which means finding a family fast
 *   Teaching   the classes themselves and the calendar they produce
 *   Setup      the words a class is assembled from, edited rarely
 *   System     the machinery, watched rather than worked
 *
 * Seat holds and the outbox moved into System because that is what they are.
 * They read like queues demanding attention, and they are not: both empty
 * themselves, and a badge that never reaches zero teaches people to ignore
 * badges.
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
    { href: "/admin", label: "Overview", icon: "grid", exact: true },
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

  const teaching: Item[] = [
    { href: "/admin/classes", label: "Classes", icon: "layers", count: counts.classes, tone: "quiet" },
    { href: "/admin/schedule", label: "Schedule", icon: "calendar" },
  ];

  const setup: Item[] = [
    { href: "/admin/setup/programs", label: "Programs", icon: "book" },
    { href: "/admin/setup/campuses", label: "Campuses", icon: "building" },
    { href: "/admin/setup/terms", label: "Terms", icon: "calendar" },
  ];

  const system: Item[] = [
    { href: "/admin/holds", label: "Seat holds", icon: "clock", count: counts.holds, tone: "quiet" },
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
      <Group label="Teaching" items={teaching} pathname={pathname} />
      <Group label="Setup" items={setup} pathname={pathname} />
      <Group label="System" items={system} pathname={pathname} />

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
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
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

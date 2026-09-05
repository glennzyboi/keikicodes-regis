"use client";

import Link from "next/link";

/**
 * Sub tabs for the money page.
 *
 * Real links with a query parameter rather than client state, so a staff member
 * can paste "look at the refunds tab" into a chat and it opens on the refunds
 * tab for whoever receives it.
 */
export function MoneyTabs({
  active,
  counts,
}: {
  active: string;
  counts: { unconfirmed: number; cancellations: number; refunds: number; ledger: number };
}) {
  const tabs = [
    { key: "unconfirmed", label: "Unconfirmed", count: counts.unconfirmed, tone: "danger" },
    { key: "cancellations", label: "Cancellations", count: counts.cancellations, tone: "warn" },
    { key: "refunds", label: "Refunds owed", count: counts.refunds, tone: "warn" },
    { key: "ledger", label: "All orders", count: counts.ledger, tone: "quiet" },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`/admin/money?tab=${t.key}`}
          className="ops-btn"
          data-chosen={active === t.key}
          aria-current={active === t.key ? "page" : undefined}
        >
          {t.label}
          {t.count > 0 && (
            <span className={`ops-pill ops-pill-${active === t.key ? "info" : t.tone}`}>
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
